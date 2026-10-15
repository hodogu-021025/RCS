// 챗봇 헤더 아이콘 (선으로 그린 계정·말풍선·스피커·마이크). 헤더와 사용법 안내(Tutorial)가 같이 쓴다
const ICON = { stroke: "currentColor", strokeWidth: 1.5, fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const AccountIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <circle cx="8" cy="5.5" r="3" {...ICON} />
    <path d="M2.5 14.5a5.5 5.5 0 0 1 11 0" {...ICON} />
  </svg>
);
export const MicIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" {...ICON} />
    <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5M5.5 14.5h5" {...ICON} />
  </svg>
);
export const ChatIcon = ({ hidden }: { hidden: boolean }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M3 3h10a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5H7.5L4.5 14v-2.5H3A1.5 1.5 0 0 1 1.5 10V4.5A1.5 1.5 0 0 1 3 3z" {...ICON} />
    {hidden && <path d="M2 1.5l12 13" {...ICON} />}
  </svg>
);
export const SpeakerIcon = ({ muted }: { muted: boolean }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M2.5 6h2.5l3-2.5v9l-3-2.5H2.5z" {...ICON} />
    {muted ? <path d="M10.5 6l3 4M13.5 6l-3 4" {...ICON} /> : <path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9" {...ICON} />}
  </svg>
);
export const HelpIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M6 6a2 2 0 1 1 2.8 1.84c-.5.22-.8.7-.8 1.24V10" {...ICON} />
    <circle cx="8" cy="12.6" r=".4" {...ICON} />
  </svg>
);
export const PlusIcon = () => (
  <svg viewBox="0 0 16 16" width="12.6" height="12.6" aria-hidden="true">
    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
  </svg>
);
// 입력창 왼쪽 빠른 메뉴 버튼의 + (헤더 아이콘보다 크고 굵게)
export const MenuIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <path d="M8 3v10M3 8h10" {...ICON} strokeWidth={2} />
  </svg>
);
