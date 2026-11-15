#include "Player.h"
#include <QFileInfo>
#include <algorithm>
#include <cmath>

Player::Player(QObject* parent):QObject(parent) {
    qRegisterMetaType<tfv::MediaInfo>();
    qRegisterMetaType<tfv::VideoFrame>();
    m_worker.setDecodeOptions(2,true,1920*1080,80,4,8);
    m_tick.setInterval(8); m_tick.setTimerType(Qt::PreciseTimer);
    connect(&m_tick,&QTimer::timeout,this,&Player::tick);
    m_preview.setSingleShot(true);m_preview.setInterval(16);m_preview.setTimerType(Qt::PreciseTimer);
    connect(&m_preview,&QTimer::timeout,this,&Player::flushPreview);
    connect(&m_worker,&tfv::MediaWorker::opened,this,[this](quint64 gen,tfv::MediaInfo info){
        if(gen!=m_generation)return;
        m_info=info;m_loaded=info.frameCount>0;m_playing=m_loaded;
        m_status=QString("%1 × %2 · %3 fps").arg(info.width).arg(info.height).arg(info.fps,0,'f',2);
        emit changed();request(0);resetClock();m_tick.start();
    });
    connect(&m_worker,&tfv::MediaWorker::decoded,this,[this](quint64 gen,quint64 epoch,int index,tfv::VideoFrame pixels,quint64 serial){
        if(gen!=m_generation||epoch!=m_epoch||pixels.isNull()||serial<m_accepted)return;
        if(!m_scrubbing) {
            if(m_playing) {if(index<m_frame||index>m_requested)return;m_frame=index;}
            else if(index!=m_requested)return;
        }
        m_accepted=serial;m_presented=index;
        emit frameReady(pixels);emit presented(index);emit changed();
        if(m_scrubbing&&!m_playing)m_audio.scrub(double(index)/m_info.fps,55,m_volume);
    });
    connect(&m_worker,&tfv::MediaWorker::cacheUpdated,this,[this](quint64 gen,qint64 bytes,QVariantList ranges){
        if(gen!=m_generation)return;m_cacheBytes=bytes;m_ranges=std::move(ranges);emit cacheChanged();
    });
    connect(&m_worker,&tfv::MediaWorker::audioReady,this,[this](quint64 gen,QByteArray pcm){
        if(gen!=m_generation)return;m_audio.load(std::move(pcm));if(m_playing&&!m_scrubbing)resetClock();
    });
    connect(&m_worker,&tfv::MediaWorker::failed,this,[this](quint64 gen,QString error){
        if(gen!=m_generation)return;pause();m_loaded=false;m_status=error;emit changed();
    });
    connect(&m_worker,&tfv::MediaWorker::warning,this,[this](quint64 gen,QString warning){if(gen==m_generation){m_status=warning;emit changed();}});
}
QString Player::fileName()const{return QFileInfo(m_path).fileName();}
void Player::open(const QString& path){
    pause();m_path=path;m_loaded=false;m_frame=m_requested=0;m_presented=-1;m_epoch=m_accepted=0;
    m_info={};m_ranges.clear();m_cacheBytes=0;m_audio.load({});m_status="Opening video…";
    emit frameReady({});
    m_worker.open(path,++m_generation,512LL*1048576,64LL*1048576);
    emit changed();emit cacheChanged();
}
void Player::unload(){
    pause();++m_generation;m_loaded=false;m_path.clear();m_info={};
    m_ranges.clear();m_cacheBytes=0;m_audio.load({});
    // Cancellation and pixel/codec destruction happen on the decoder worker.
    m_worker.open({},m_generation,0,0);
    emit frameReady({});emit changed();emit cacheChanged();
}
void Player::request(int frame,tfv::MediaWorker::RequestKind kind){
    m_requested=frame;
    m_worker.setPlaybackRange(0,m_info.frameCount-1,m_playing&&!m_scrubbing,m_loop);
    m_worker.seek(frame,m_epoch,m_scrubbing?m_direction:1,kind);
}
void Player::resetClock(){
    m_anchor=m_frame;m_clock.restart();m_audio.stop();
    if(m_playing&&!m_scrubbing)m_audio.play(double(m_frame)/m_info.fps,1.,m_volume);
}
void Player::toggle(){
    if(!m_loaded)return;
    if(m_playing){pause();return;}
    if(m_frame>=m_info.frameCount-1)m_frame=0;
    m_playing=true;++m_epoch;request(m_frame);resetClock();m_tick.start();emit changed();
}
void Player::pause(){
    m_playing=false;m_scrubbing=false;m_preview.stop();m_tick.stop();m_audio.stop();
    ++m_epoch;if(m_loaded)request(m_frame);emit changed();
}
void Player::step(int direction){
    if(!m_loaded)return;pause();m_frame=std::clamp(m_frame+direction,0,m_info.frameCount-1);request(m_frame);emit changed();
}
void Player::preview(int frame){
    if(!m_loaded)return;
    frame=std::clamp(frame,0,m_info.frameCount-1);
    if(!m_scrubbing){m_scrubbing=true;++m_epoch;m_audio.stop();m_worker.setPlaybackRange(0,m_info.frameCount-1,false,m_loop);}
    if(frame!=m_frame)m_direction=frame>m_frame?1:-1;
    m_frame=frame;emit changed();if(!m_preview.isActive())m_preview.start();
}
void Player::flushPreview(){if(m_scrubbing)request(m_frame,tfv::MediaWorker::RequestKind::Preview);}
void Player::finishScrub(){
    if(!m_loaded||!m_scrubbing)return;
    m_preview.stop();m_scrubbing=false;++m_epoch;request(m_frame);
    if(m_playing)resetClock();else m_audio.scrub(double(m_frame)/m_info.fps,55,m_volume);
    emit changed();
}
void Player::tick(){
    if(!m_loaded||!m_playing||m_scrubbing)return;
    int next=m_anchor+int(std::floor(m_clock.elapsed()/1000.*m_info.fps));
    if(m_audio.clockAvailable())next=int(std::floor(m_audio.seconds()*m_info.fps));
    next=std::max(next,m_requested);
    if(next>=m_info.frameCount){
        if(!m_loop){pause();m_frame=m_info.frameCount-1;request(m_frame);return;}
        m_frame=0;++m_epoch;request(0);resetClock();emit changed();return;
    }
    if(next!=m_requested)request(next,tfv::MediaWorker::RequestKind::Playback);
}
void Player::setVolume(double volume){m_volume=std::clamp(volume,0.,1.);m_audio.setVolume(m_volume);emit changed();}
void Player::setLoop(bool loop){m_loop=loop;m_worker.setPlaybackRange(0,m_info.frameCount-1,m_playing&&!m_scrubbing,m_loop);emit changed();}
