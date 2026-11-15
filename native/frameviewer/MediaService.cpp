#include "Player.h"
#include <QCoreApplication>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QTimer>
#include <QtEndian>
#include <algorithm>
#include <windows.h>

// No Qt GUI application, QML engine, native surface, HWND parenting or CLI
// session arguments. Qt Core/Multimedia only support the reused media engine.
class MediaService final : public QObject {
    Player m_player;
    QTimer m_poll, m_state, m_idle;
    QByteArray m_input;
    QString m_session;
    tfv::VideoFrame m_pending;
    bool m_busy=false;
    quint64 m_packet=0;
    QString m_inflight;

    static void writeAll(const char* data,qsizetype size) {
        const auto pipe=GetStdHandle(STD_OUTPUT_HANDLE);
        while(size>0){
            DWORD written=0;
            if(!WriteFile(pipe,data,DWORD(std::min<qsizetype>(size,65536)),&written,nullptr)||written==0){QCoreApplication::quit();return;}
            data+=written;size-=written;
        }
    }
    void message(quint32 kind,const QByteArray& payload) {
        char header[12]={'M','F','M','1'};
        qToLittleEndian<quint32>(kind,reinterpret_cast<uchar*>(header+4));
        qToLittleEndian<quint32>(quint32(payload.size()),reinterpret_cast<uchar*>(header+8));
        writeAll(header,12);writeAll(payload.constData(),payload.size());
    }
    void json(QJsonObject value){message(1,QJsonDocument(value).toJson(QJsonDocument::Compact));}
    void state(){
        if(m_session.isEmpty())return;
        const bool failed=!m_player.loaded()&&m_player.status()!="Opening video…";
        json({{"event","state"},{"session",m_session},{"loaded",m_player.loaded()},
              {"playing",m_player.playing()},{"frame",m_player.frame()},
              {"frameCount",m_player.frameCount()},{"fps",m_player.fps()},
              {"aspect",m_player.aspect()},{"fileName",m_player.fileName()},
              {"status",m_player.status()},{"error",failed?m_player.status():QString{}},
              {"volume",m_player.volume()},{"loop",m_player.loop()},
              {"cacheMiB",m_player.cacheMiB()},{"ranges",QJsonArray::fromVariantList(m_player.ranges())}});
    }
    void frame(){
        if(m_busy||m_pending.isNull()||m_session.isEmpty())return;
        auto pixels=std::move(m_pending);m_pending={};
        const bool yuv=pixels.format()==tfv::VideoFrame::Format::Yuv420;
        QJsonObject metadata{{"session",m_session},{"packet",QString::number(++m_packet)},
            {"identity",QString::number(pixels.identity())},{"index",pixels.sourceIndex()},
            {"width",pixels.size().width()},{"height",pixels.size().height()},
            {"format",yuv?"yuv420":"rgba"}};
        QJsonArray planes,matrix;QByteArray bytes;
        if(yuv){
            for(int p=0;p<3;++p){const auto& plane=pixels.plane(p);
                planes.append(QJsonObject{{"width",plane.size.width()},{"height",plane.size.height()},{"stride",plane.stride},{"length",plane.bytes.size()}});
                bytes.append(plane.bytes);
            }
            const auto transform=pixels.colorTransform();
            for(int i=0;i<16;++i)matrix.append(transform.constData()[i]);
        }else{
            const auto image=pixels.toImage();
            planes.append(QJsonObject{{"width",image.width()},{"height",image.height()},{"stride",image.bytesPerLine()},{"length",image.sizeInBytes()}});
            bytes.append(reinterpret_cast<const char*>(image.constBits()),image.sizeInBytes());
        }
        metadata.insert("planes",planes);metadata.insert("matrix",matrix);
        const auto encoded=QJsonDocument(metadata).toJson(QJsonDocument::Compact);
        QByteArray payload(4,Qt::Uninitialized);
        qToLittleEndian<quint32>(quint32(encoded.size()),reinterpret_cast<uchar*>(payload.data()));
        payload.append(encoded);payload.append(bytes);
        m_busy=true;m_inflight=metadata.value("packet").toString();
        message(2,payload);
    }
    void command(const QJsonObject& value){
        const auto type=value.value("type").toString();
        if(type=="quit"){m_player.unload();QCoreApplication::quit();return;}
        if(type=="open"){
            m_idle.stop();m_state.stop();m_busy=false;m_pending={};
            m_session=value.value("session").toString();
            m_player.open(value.value("path").toString());state();return;
        }
        if(value.value("session").toString()!=m_session||m_session.isEmpty())return;
        if(type=="close"){
            const auto closed=m_session;m_session.clear();m_busy=false;m_pending={};m_state.stop();m_player.unload();m_idle.start();
            json({{"event","closed"},{"session",closed},{"loaded",false},{"cacheMiB",0}});return;
        }
        if(type=="ack"){
            if(value.value("packet").toString()==m_inflight){m_busy=false;frame();}return;
        }
        if(type!="control")return;
        const auto action=value.value("control").toString();
        if(action=="toggle")m_player.toggle();
        else if(action=="pause")m_player.pause();
        else if(action=="step")m_player.step(value.value("value").toInt());
        else if(action=="preview")m_player.preview(value.value("value").toInt());
        else if(action=="finishScrub")m_player.finishScrub();
        else if(action=="volume")m_player.setVolume(value.value("value").toDouble());
        else if(action=="loop")m_player.setLoop(value.value("value").toBool());
        state();
    }
    void poll(){
        DWORD available=0;const auto pipe=GetStdHandle(STD_INPUT_HANDLE);
        if(!PeekNamedPipe(pipe,nullptr,0,nullptr,&available,nullptr)){QCoreApplication::quit();return;}
        if(!available)return;
        char buffer[8192];DWORD received=0;
        if(!ReadFile(pipe,buffer,std::min<DWORD>(available,sizeof(buffer)),&received,nullptr))return;
        m_input.append(buffer,int(received));
        if(m_input.size()>65536){QCoreApplication::quit();return;}
        int end;
        while((end=m_input.indexOf('\n'))>=0){
            auto doc=QJsonDocument::fromJson(m_input.left(end));m_input.remove(0,end+1);
            if(doc.isObject())command(doc.object());
        }
    }
  public:
    MediaService(){
        m_poll.setInterval(4);m_poll.setTimerType(Qt::PreciseTimer);
        connect(&m_poll,&QTimer::timeout,this,[this]{poll();});
        m_state.setSingleShot(true);m_state.setInterval(16);
        connect(&m_state,&QTimer::timeout,this,[this]{state();});
        const auto dirty=[this]{if(!m_state.isActive())m_state.start();};
        connect(&m_player,&Player::changed,this,dirty);connect(&m_player,&Player::cacheChanged,this,dirty);
        connect(&m_player,&Player::frameReady,this,[this](tfv::VideoFrame pixels){
            if(pixels.isNull())return;m_pending=std::move(pixels);frame();
        });
        m_idle.setSingleShot(true);m_idle.setInterval(30000);
        connect(&m_idle,&QTimer::timeout,qApp,&QCoreApplication::quit);
        m_poll.start();m_idle.start();
        json({{"event","ready"},{"protocol",1},{"engine","frameviewer"}});
    }
};
int main(int argc,char** argv){
    QCoreApplication app(argc,argv);
    app.setApplicationName("Moodframe Media Engine");
    app.setApplicationVersion(MOODFRAME_VERSION);
    MediaService service;
    return app.exec();
}
