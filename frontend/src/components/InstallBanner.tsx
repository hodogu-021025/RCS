import { useState, useSyncExternalStore } from "react";
import { dismissInstall, installMode, promptInstall, subscribeInstall } from "../pwa";
import "./installBanner.css";

// 채팅 입력창 바로 위의 작은 "앱으로 설치" 띠 (pwa.ts 가 띄울지 정한다).
// 안드로이드: 앱 받기 화면(#/app)으로 가서 앱 파일(APK)을 받는다 (크롬이 아닌 브라우저에서도).
// 아이폰: 설치 창이 없어서 홈 화면에 추가하는 순서를 알려 준다. 데스크톱 크롬 등: "설치"를 누르면 브라우저의 설치 창이 열린다
export function InstallBanner() {
  const mode = useSyncExternalStore(subscribeInstall, () => installMode(), () => null);
  const [busy, setBusy] = useState(false);
  if (!mode) return null;

  async function install() {
    setBusy(true);
    try {
      await promptInstall();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="install-banner" role="region" aria-label="앱으로 설치">
      <img className="install-icon" src="/icon-192.png" alt="" width={32} height={32} />
      {mode === "ios" ? (
        <p>
          홈 화면에 추가하면 앱처럼 쓸 수 있어요. 아래 <b>공유</b> 버튼을 누르고 <b>홈 화면에 추가</b>를 골라 주세요.
        </p>
      ) : mode === "android" ? (
        <p>Saylo 앱을 받으면 홈 화면에서 바로 열 수 있어요.</p>
      ) : (
        <p>Saylo를 앱으로 설치하면 홈 화면에서 바로 열 수 있어요.</p>
      )}
      <div className="install-actions">
        {mode === "android" && (
          <a className="install-go" href="#/app">
            앱 받기
          </a>
        )}
        {mode === "prompt" && (
          <button type="button" className="install-go" onClick={() => void install()} disabled={busy}>
            설치
          </button>
        )}
        <button type="button" className="install-close" onClick={() => dismissInstall()} aria-label="앱 설치 안내 닫기">
          닫기
        </button>
      </div>
    </div>
  );
}
