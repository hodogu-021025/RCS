import { useId, useState, type InputHTMLAttributes } from "react";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "id"> {
  label: string;
}

const ICON = { stroke: "currentColor", strokeWidth: 1.5, fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;

// 감은 눈: 아래로 처진 눈꺼풀 + 속눈썹
const EyeClosed = () => (
  <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
    <path d="M2 7c1.6 2.3 3.7 3.5 6 3.5S12.4 9.3 14 7" {...ICON} />
    <path d="M4.3 9.4 3.2 11M8 10.5v1.9M11.7 9.4l1.1 1.6" {...ICON} />
  </svg>
);
// 뜬 눈
const EyeOpen = () => (
  <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
    <path d="M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" {...ICON} />
    <circle cx="8" cy="8" r="2" {...ICON} />
  </svg>
);

// 비밀번호 입력칸. 처음에는 눈이 감겨 있고 글자가 가려져 있다가, 눈을 누르면 눈이 뜨이고 글자가 보인다
export function PasswordField({ label, ...inputProps }: Props) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="pw-field">
      <label htmlFor={id}>
        <span>{label}</span>
      </label>
      <div className="pw-wrap">
        <input {...inputProps} id={id} className="pw-input" type={shown ? "text" : "password"} />
        <button
          type="button"
          className="pw-toggle"
          aria-label={shown ? `${label} 숨기기` : `${label} 보기`}
          aria-pressed={shown}
          aria-controls={id}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? <EyeOpen /> : <EyeClosed />}
        </button>
      </div>
    </div>
  );
}
