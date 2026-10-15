import { APK_URL, isIOS, isInAppBrowser } from "../pwa";
import "./appDownload.css";

// 앱 받기 (#/app). 로그인하지 않아도 볼 수 있다.
// 안드로이드: 사이트를 감싼 Saylo 앱 파일(APK)을 받아 설치한다 (플레이 스토어를 거치지 않는다).
// 아이폰: 앱 파일을 받을 수 없으므로 사파리에서 홈 화면에 추가하는 방법을 알려 준다. 지금 쓰는 기기의 안내를 먼저 보여 준다
export function AppDownloadPage() {
  const ios = isIOS();
  const inApp = isInAppBrowser();
  const android = (
    <section className="dash-section app-get" key="android">
      <h2>안드로이드</h2>
      <p>Saylo 앱 파일을 받아 설치해요. 사이트를 고치면 앱에도 바로 반영돼서 앱을 다시 받을 일은 거의 없어요.</p>
      <a className="btn primary app-get-button" href={APK_URL} download="saylo.apk">
        안드로이드 앱 다운로드
      </a>
      <ol className="app-steps">
        <li>위의 "안드로이드 앱 다운로드"를 눌러 파일을 받아요.</li>
        <li>다 받으면 알림이나 "내 파일"의 다운로드 폴더에서 saylo.apk를 눌러요.</li>
        <li>"출처를 알 수 없는 앱" 설치를 허용하라는 창이 뜨면, 설정에서 지금 쓰는 브라우저의 허용을 켜요.</li>
        <li>"설치"를 누르면 홈 화면에 Saylo가 생겨요.</li>
      </ol>
      <p className="app-note">
        플레이 스토어를 거치지 않은 앱이라 설치할 때 보안 경고가 뜰 수 있어요. Saylo에서 직접 만든 앱이에요.
      </p>
    </section>
  );
  const iphone = (
    <section className="dash-section app-get" key="ios">
      <h2>아이폰</h2>
      <p>아이폰은 앱 파일을 받을 수 없어서, 홈 화면에 추가해 앱처럼 써요.</p>
      <ol className="app-steps">
        <li>사파리에서 sayloorder.com을 열어요.</li>
        <li>아래쪽 가운데의 공유 버튼을 눌러요.</li>
        <li>"홈 화면에 추가"를 고르고 "추가"를 눌러요.</li>
      </ol>
    </section>
  );

  return (
    <div className="dash dash-mobile">
      <header className="dash-head">
        <a className="dash-logo" href="#/chat" aria-label="채팅 화면으로">
          Saylo
        </a>
        <span className="dash-title">앱 받기</span>
      </header>
      <main className="dash-main policy">
        {inApp && (
          <p className="app-inapp" role="note">
            카카오톡 같은 앱 안에서 열었다면 오른쪽 위나 아래의 메뉴에서 "다른 브라우저로 열기"를 눌러 크롬·삼성 인터넷·사파리로 연 뒤에 받아 주세요.
          </p>
        )}
        {ios ? [iphone, android] : [android, iphone]}
        <a className="app-back" href="#/chat">
          채팅으로 돌아가기
        </a>
      </main>
    </div>
  );
}
