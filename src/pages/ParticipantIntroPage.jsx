import { Icon } from "../components/Icons.jsx";

const STEPS = [
  {
    icon: "profiles",
    title: "配置你的 Agent",
    description: "依次填写三组 Profile，让 Agent 了解你的目标、偏好、边界和需要你本人确认的事项。",
  },
  {
    icon: "plus",
    title: "按需添加配置项",
    description: "固定问题没有覆盖到的条件，可以点击“添加输入项”自由补充，也可以删除自己添加的项目。",
  },
  {
    icon: "save",
    title: "点击保存配置",
    description: "填写完成后点击页面右上角的“保存配置”。只有保存后的内容才会提供给你的 Agent。",
  },
];

export default function ParticipantIntroPage({ user, onNavigate }) {
  return (
    <div className="participant-intro">
      <section className="intro-hero">
        <span className="intro-kicker">开始前 · 约1分钟</span>
        <h1>先告诉 Agent，怎样代表你</h1>
        <p>你将配置一个代表你与其他 Agent 交流的代理。请提供足够具体的信息，让它知道你想要什么、哪些条件可以商量，以及什么必须由你决定。</p>
      </section>

      <section className="intro-steps" aria-label="Agent配置步骤">
        {STEPS.map((step, index) => (
          <article className="intro-step" key={step.title}>
            <div className="intro-step-top">
              <span className="intro-step-number">{index + 1}</span>
              <span className="intro-step-icon"><Icon name={step.icon} size={25} /></span>
            </div>
            <h2>{step.title}</h2>
            <p>{step.description}</p>
          </article>
        ))}
      </section>

      <section className="intro-note">
        <span className="intro-note-icon">i</span>
        <div>
          <strong>填写时不必追求“标准答案”</strong>
          <p>请按照你自己的真实偏好填写。输入框中的灰色文字只是示例，不会成为你的配置。</p>
        </div>
      </section>

      <div className="intro-actions">
        <span>当前登录：{user.id}</span>
        <button type="button" className="button button-primary intro-start" onClick={() => onNavigate("profiles")}>
          开始配置 <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}
