import { useState } from "react";
import { PHONE_PLACEHOLDER, formatPhoneInput, normalizePhone } from "../components/delivery";

interface Props {
  label?: string;
  value: string;
  onChange: (value: string) => void;
}

// 전화번호 입력칸. 숫자만 받아 적는 동안 010-1234-5678 모양으로 하이픈을 넣고,
// 칸을 벗어났는데 번호 모양이 아니면 빨갛게 표시한다 (적는 중에는 표시하지 않는다)
export function PhoneField({ label = "휴대폰 번호", value, onChange }: Props) {
  const [left, setLeft] = useState(false);
  const invalid = left && !!value && !normalizePhone(value);
  return (
    <label>
      <span>{label}</span>
      <input
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        value={value}
        onChange={(e) => {
          setLeft(false);
          onChange(formatPhoneInput(e.target.value));
        }}
        onBlur={() => setLeft(true)}
        placeholder={PHONE_PLACEHOLDER}
        maxLength={13}
        aria-invalid={invalid || undefined}
      />
    </label>
  );
}
