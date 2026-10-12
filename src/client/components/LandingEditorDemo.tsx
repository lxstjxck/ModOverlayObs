import { Image, Layers3, MonitorPlay, Play, Smile, Type, Video } from "lucide-react";

export function LandingEditorDemo() {
  return (
    <div
      className="landing-demo"
      role="img"
      aria-label="Иллюстрация редактора: медиа в области SPAWN, отдельный холст трансляции и список слоёв"
    >
      <div className="landing-demo-bar">
        <div className="landing-demo-dots">
          <i />
          <i />
          <i />
        </div>
        <span>Редактор оверлея</span>
        <span className="landing-demo-status">
          <i /> Предпросмотр
        </span>
      </div>
      <div className="landing-demo-body">
        <div className="landing-demo-tools">
          <span className="landing-demo-tools-title">МЕДИА</span>
          <div className="landing-demo-tool active">
            <Image size={16} /> Изображения
          </div>
          <div className="landing-demo-tool">
            <Video size={16} /> Видео
          </div>
          <div className="landing-demo-tool">
            <Smile size={16} /> Смайлы
          </div>
          <div className="landing-demo-tool">
            <Type size={16} /> Текст
          </div>
          <div className="landing-demo-asset">
            <span className="landing-demo-asset-art">✦</span>
            <span>
              reaction.gif<small>GIF · 1.2 МБ</small>
            </span>
          </div>
          <div className="landing-demo-asset">
            <span className="landing-demo-asset-art violet">▶</span>
            <span>
              intro.mp4<small>Видео · 8.4 МБ</small>
            </span>
          </div>
        </div>
        <div className="landing-demo-workspace">
          <div className="landing-demo-workspace-top">
            <span>Холст · 1920 × 1080</span>
            <span>100%</span>
          </div>
          <div className="landing-demo-stage">
            <div className="landing-demo-spawn">
              <span>SPAWN</span>
              <span className="landing-demo-spawn-object">✦</span>
            </div>
            <div className="landing-demo-canvas">
              <span className="landing-demo-live">
                <i /> OBS
              </span>
              <span className="landing-demo-canvas-caption">
                Ваш контент
                <br />
                <strong>в нужный момент.</strong>
              </span>
              <span className="landing-demo-sticker">✦</span>
              <span className="landing-demo-play">
                <Play size={13} fill="currentColor" />
              </span>
            </div>
          </div>
          <div className="landing-demo-timeline">
            <span />
            <span />
            <span />
          </div>
        </div>
        <div className="landing-demo-layers">
          <div>
            <Layers3 size={15} /> Слои
          </div>
          <span>✦ &nbsp; reaction.gif</span>
          <span>
            <MonitorPlay size={14} /> intro.mp4
          </span>
        </div>
      </div>
      <div className="landing-demo-footer">
        <span>
          <i /> Подключено к OBS
        </span>
        <span>Предпросмотр → эфир</span>
      </div>
    </div>
  );
}
