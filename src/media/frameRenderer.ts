export interface FrameInfo {
  session: string;
  packet: string;
  identity: string;
  index: number;
  width: number;
  height: number;
  format: 'yuv420' | 'rgba';
  matrix: number[];
  planes: { width: number; height: number; stride: number; length: number }[];
}
export interface Frame { info: FrameInfo; planes: Uint8Array[] }
export function decodeFrame(buffer: ArrayBuffer): Frame {
  if (buffer.byteLength < 4) throw new Error('Truncated video frame');
  const length = new DataView(buffer).getUint32(0, true);
  if (length > 65536 || length + 4 > buffer.byteLength) throw new Error('Invalid video frame header');
  const info = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, length))) as FrameInfo;
  if (!['yuv420', 'rgba'].includes(info.format) || !Number.isInteger(info.width) || !Number.isInteger(info.height) || info.width < 1 || info.height < 1 || info.width * info.height > 100_000_000) throw new Error('Invalid video dimensions');
  if (info.planes.length !== (info.format === 'yuv420' ? 3 : 1)) throw new Error('Invalid video planes');
  if (info.format === 'yuv420' && (info.matrix.length !== 16 || info.matrix.some((n) => !Number.isFinite(n)))) throw new Error('Invalid video color matrix');
  let offset = 4 + length;
  const planes = info.planes.map((plane, index) => {
    const width = info.format === 'yuv420' && index > 0 ? Math.ceil(info.width / 2) : info.width;
    const height = info.format === 'yuv420' && index > 0 ? Math.ceil(info.height / 2) : info.height;
    const row = info.format === 'rgba' ? width * 4 : width;
    if (plane.width !== width || plane.height !== height || !Number.isInteger(plane.stride) || plane.stride < row || (info.format === 'rgba' && plane.stride % 4 !== 0) || !Number.isInteger(plane.length) || plane.length !== plane.stride * height || offset + plane.length > buffer.byteLength) throw new Error('Invalid video plane payload');
    const bytes = new Uint8Array(buffer, offset, plane.length); offset += plane.length; return bytes;
  });
  if (offset !== buffer.byteLength) throw new Error('Unexpected bytes in video frame');
  return { info, planes };
}

type TextureFrame = { textures: WebGLTexture[]; bytes: number; info: FrameInfo };
const vertexShader = `#version 300 es
in vec2 position;
out vec2 uv;
void main() { gl_Position=vec4(position,0.0,1.0); uv=vec2((position.x+1.0)*0.5,(1.0-position.y)*0.5); }`;
const fragmentShader = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D planeY;
uniform sampler2D planeU;
uniform sampler2D planeV;
uniform mat4 colorTransform;
uniform bool rgba;
out vec4 color;
void main() {
  if(rgba) color=texture(planeY,uv);
  else color=vec4(clamp((colorTransform*vec4(texture(planeY,uv).r,texture(planeU,uv).r,texture(planeV,uv).r,1.0)).rgb,0.0,1.0),1.0);
}`;

/** Reuses FrameViewer's compact YUV planes and color matrix in the WebView GPU. */
export class FrameRenderer {
  private gl: WebGL2RenderingContext | null;
  private cpu: CanvasRenderingContext2D | null = null;
  private program: WebGLProgram | null = null;
  private vertexBuffer: WebGLBuffer | null = null;
  private neutralTexture: WebGLTexture | null = null;
  private frames = new Map<string, TextureFrame>();
  private bytes = 0;
  private disposed = false;
  private canvas: HTMLCanvasElement;
  constructor(canvas: HTMLCanvasElement, private budget = 96 * 1024 * 1024) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (!this.gl) {
      this.cpu = canvas.getContext('2d', { alpha: false });
      if (!this.cpu) throw new Error('Unable to initialize video canvas');
      return;
    }
    const gl = this.gl;
    const compile = (kind: number, source: string) => {
      const shader = gl.createShader(kind); if (!shader) throw new Error('Unable to allocate video shader');
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const message = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(message ?? 'Video shader compilation failed'); }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, vertexShader), fragment = compile(gl.FRAGMENT_SHADER, fragmentShader);
    const program = gl.createProgram(); if (!program) throw new Error('Unable to allocate video program');
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Video shader linking failed');
    this.program = program; gl.useProgram(program);
    this.vertexBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(gl.getUniformLocation(program, 'planeY'), 0); gl.uniform1i(gl.getUniformLocation(program, 'planeU'), 1); gl.uniform1i(gl.getUniformLocation(program, 'planeV'), 2);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.neutralTexture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.neutralTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([128]));
  }
  get stats() { return { cachedFrames: this.frames.size, gpuBytes: this.bytes, renderer: this.gl ? 'webgl2' : 'canvas2d' }; }
  draw(frame: Frame) {
    if (this.disposed) return;
    const { info } = frame;
    if (this.canvas.width !== info.width || this.canvas.height !== info.height) { this.canvas.width = info.width; this.canvas.height = info.height; }
    const gl = this.gl;
    if (!gl) { this.drawCpu(frame); return; }
    if (gl.isContextLost()) throw new Error('Video graphics context was lost');
    if (info.width > gl.getParameter(gl.MAX_TEXTURE_SIZE) || info.height > gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw new Error('This video exceeds the graphics device texture size');
    let entry = this.frames.get(info.identity);
    if (entry) { this.frames.delete(info.identity); this.frames.set(info.identity, entry); }
    else {
      const textures: WebGLTexture[] = []; let bytes = 0;
      for (let i = 0; i < info.planes.length; i++) {
        const plane = info.planes[i], texture = gl.createTexture();
        if (!texture) throw new Error('Unable to allocate video texture');
        textures.push(texture); gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, info.format === 'rgba' ? plane.stride / 4 : plane.stride);
        gl.texImage2D(gl.TEXTURE_2D, 0, info.format === 'rgba' ? gl.RGBA8 : gl.R8, plane.width, plane.height, 0, info.format === 'rgba' ? gl.RGBA : gl.RED, gl.UNSIGNED_BYTE, frame.planes[i]);
        bytes += plane.width * plane.height * (info.format === 'rgba' ? 4 : 1);
      }
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
      entry = { textures, bytes, info }; this.frames.set(info.identity, entry); this.bytes += bytes;
    }
    gl.useProgram(this.program); gl.viewport(0, 0, info.width, info.height);
    for (let index = 0; index < 3; index++) { gl.activeTexture(gl.TEXTURE0 + index); gl.bindTexture(gl.TEXTURE_2D, entry.textures[index] ?? this.neutralTexture); }
    gl.uniform1i(gl.getUniformLocation(this.program!, 'rgba'), info.format === 'rgba' ? 1 : 0);
    if (info.format === 'yuv420') gl.uniformMatrix4fv(gl.getUniformLocation(this.program!, 'colorTransform'), false, new Float32Array(info.matrix));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    while (this.bytes > this.budget && this.frames.size > 1) {
      const [key, old] = this.frames.entries().next().value!; old.textures.forEach((texture) => gl.deleteTexture(texture)); this.frames.delete(key); this.bytes -= old.bytes;
    }
  }
  private drawCpu(frame: Frame) {
    const { width, height, format, planes: layout, matrix: m } = frame.info;
    const output = new Uint8ClampedArray(width * height * 4);
    if (format === 'rgba') {
      for (let y = 0; y < height; y++) output.set(frame.planes[0].subarray(y * layout[0].stride, y * layout[0].stride + width * 4), y * width * 4);
      this.cpu!.putImageData(new ImageData(output, width, height), 0, 0); return;
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4;
      const luma = frame.planes[0][y * layout[0].stride + x] / 255;
      const u = frame.planes[1][Math.floor(y / 2) * layout[1].stride + Math.floor(x / 2)] / 255;
      const v = frame.planes[2][Math.floor(y / 2) * layout[2].stride + Math.floor(x / 2)] / 255;
      for (let c = 0; c < 3; c++) output[target + c] = Math.round(Math.min(1, Math.max(0, m[c] * luma + m[4+c] * u + m[8+c] * v + m[12+c])) * 255);
      output[target + 3] = 255;
    }
    this.cpu!.putImageData(new ImageData(output, width, height), 0, 0);
  }
  dispose() {
    this.disposed = true;
    const gl = this.gl;
    if (gl) { for (const entry of this.frames.values()) entry.textures.forEach((t) => gl.deleteTexture(t)); gl.deleteTexture(this.neutralTexture); gl.deleteBuffer(this.vertexBuffer); gl.deleteProgram(this.program); }
    this.canvas.width = 1; this.canvas.height = 1;
    this.frames.clear(); this.bytes = 0;
  }
}
