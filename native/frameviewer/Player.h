#pragma once
#include "media/MediaWorker.h"
#include "media/AudioEngine.h"
#include <QElapsedTimer>
#include <QTimer>

// Playback-only adapter around the unmodified Trie FrameViewer media engine.
class Player final : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool loaded READ loaded NOTIFY changed)
    Q_PROPERTY(bool playing READ playing NOTIFY changed)
    Q_PROPERTY(int frame READ frame NOTIFY changed)
    Q_PROPERTY(int frameCount READ frameCount NOTIFY changed)
    Q_PROPERTY(double fps READ fps NOTIFY changed)
    Q_PROPERTY(double aspect READ aspect NOTIFY changed)
    Q_PROPERTY(double cacheMiB READ cacheMiB NOTIFY cacheChanged)
    Q_PROPERTY(QVariantList ranges READ ranges NOTIFY cacheChanged)
    Q_PROPERTY(QString status READ status NOTIFY changed)
    Q_PROPERTY(QString fileName READ fileName NOTIFY changed)
    Q_PROPERTY(double volume READ volume WRITE setVolume NOTIFY changed)
    Q_PROPERTY(bool loop READ loop WRITE setLoop NOTIFY changed)
  public:
    explicit Player(QObject* parent=nullptr);
    bool loaded() const { return m_loaded; }
    bool playing() const { return m_playing; }
    int frame() const { return m_frame; }
    int frameCount() const { return m_info.frameCount; }
    double fps() const { return m_info.fps; }
    double aspect() const { return m_info.height>0 ? double(m_info.width)/m_info.height : 16./9.; }
    double cacheMiB() const { return m_cacheBytes/1048576.; }
    QVariantList ranges() const { return m_ranges; }
    QString status() const { return m_status; }
    QString fileName() const;
    double volume() const { return m_volume; }
    bool loop() const { return m_loop; }
    void open(const QString& path);
    void unload();
    Q_INVOKABLE void toggle();
    Q_INVOKABLE void pause();
    Q_INVOKABLE void step(int direction);
    Q_INVOKABLE void preview(int frame);
    Q_INVOKABLE void finishScrub();
    void setVolume(double volume);
    void setLoop(bool loop);
    int presentedFrame() const { return m_presented; }
  signals:
    void changed();
    void cacheChanged();
    void frameReady(tfv::VideoFrame frame);
    void presented(int frame);
  private:
    void request(int frame,tfv::MediaWorker::RequestKind kind=tfv::MediaWorker::RequestKind::Seek);
    void tick();
    void resetClock();
    void flushPreview();
    tfv::MediaWorker m_worker;
    tfv::AudioEngine m_audio;
    tfv::MediaInfo m_info;
    QTimer m_tick, m_preview;
    QElapsedTimer m_clock;
    QString m_path, m_status="Opening video…";
    quint64 m_generation=0, m_epoch=0, m_accepted=0;
    int m_frame=0, m_requested=0, m_presented=-1, m_anchor=0, m_direction=1;
    bool m_loaded=false, m_playing=false, m_scrubbing=false, m_loop=true;
    double m_volume=.25;
    qint64 m_cacheBytes=0;
    QVariantList m_ranges;
};
