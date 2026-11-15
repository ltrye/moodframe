#include "Player.h"
#include "media/FrameCache.h"
#include <QtTest>
#include <QProcess>
#include <QTemporaryDir>
class Tests:public QObject {
    Q_OBJECT
  private slots:
    void boundedCache() {
        const tfv::VideoFrame pixels(QImage(128,128,QImage::Format_RGBA8888));
        tfv::FrameCache cache(pixels.sizeInBytes()*3);
        for(int i=0;i<40;++i)cache.insert(i,pixels,i);
        QVERIFY(cache.bytes()<=pixels.sizeInBytes()*3);
        QVERIFY(cache.contains(39));
    }
    void exactSeekAndPlaybackState() {
        QTemporaryDir dir;
        const QString clip=dir.filePath("seek.mp4");
        QProcess ffmpeg;
        ffmpeg.start("ffmpeg.exe",{"-y","-f","lavfi","-i","testsrc2=size=640x360:rate=24","-t","3","-c:v","mpeg4","-g","48","-pix_fmt","yuv420p",clip});
        QVERIFY(ffmpeg.waitForFinished(30000));QCOMPARE(ffmpeg.exitCode(),0);
        Player player;player.open(clip);
        QTRY_VERIFY_WITH_TIMEOUT(player.loaded(),10000);
        QTRY_VERIFY_WITH_TIMEOUT(player.presentedFrame()>=0,10000);
        player.pause();
        for(int target:{60,3,47,12,71,0,36}) {
            player.preview(target);player.finishScrub();
            QTRY_COMPARE_WITH_TIMEOUT(player.presentedFrame(),target,5000);
            QVERIFY(!player.playing());
        }
        player.preview(20);player.finishScrub();
        QTRY_COMPARE_WITH_TIMEOUT(player.presentedFrame(),20,5000);
        player.toggle();QVERIFY(player.playing());
        player.preview(40);player.finishScrub();QVERIFY(player.playing());
        QTRY_VERIFY_WITH_TIMEOUT(player.presentedFrame()>=40,5000);
        player.pause();player.step(-1);
        const int expected=player.frame();QTRY_COMPARE_WITH_TIMEOUT(player.presentedFrame(),expected,5000);
        QTRY_VERIFY_WITH_TIMEOUT(player.cacheMiB()>0,5000);
    }
};
QTEST_GUILESS_MAIN(Tests)
#include "Tests.moc"
