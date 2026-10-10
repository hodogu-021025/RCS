// 휴대폰 키보드가 올라오면 앱 높이를 "실제로 보이는 영역"(visualViewport)에 맞춘다.
// 그냥 두면 앱은 키보드 뒤까지 원래 높이로 남고, 브라우저가 입력창을 보이게 하려고 화면을 위로 밀어서
// 채팅창을 끈 동안 가운데 뜨는 자막이 보이는 영역 위로 밀려나 가려진다.
// --app-height 는 .app 의 높이(index.css), data-keyboard 는 키보드가 떠 있는 동안 자막을 작게 맞추는 데 쓴다

// 보이는 높이가 이만큼 넘게 줄면 키보드가 올라온 것으로 본다 (주소창이 접혔다 펴지는 정도는 무시)
const KEYBOARD_MIN_PX = 150;

export function followVisualViewport(win: Window = window): () => void {
  const vv = win.visualViewport;
  if (!vv) return () => {};
  const root = win.document.documentElement;
  // 키보드가 없을 때의 높이. 화면을 돌려 폭이 바뀌면 다시 잰다
  let fullHeight = vv.height;
  let width = vv.width;

  function sync() {
    if (!vv) return;
    // 손가락으로 확대한 동안에는 보이는 영역이 작아져도 앱을 줄이지 않는다
    if (vv.scale > 1.01) {
      root.style.removeProperty("--app-height");
      root.removeAttribute("data-keyboard");
      return;
    }
    if (Math.abs(vv.width - width) > 1) {
      width = vv.width;
      fullHeight = vv.height;
    }
    fullHeight = Math.max(fullHeight, vv.height);
    const keyboard = fullHeight - vv.height > KEYBOARD_MIN_PX;
    root.style.setProperty("--app-height", `${Math.round(vv.height)}px`);
    root.toggleAttribute("data-keyboard", keyboard);
    // 아이폰은 입력창을 보이게 하려고 페이지를 내려 두므로, 채팅 화면이면 앱이 보이는 영역 맨 위에 오게 되돌린다.
    // (회원가입처럼 긴 화면은 브라우저가 입력칸까지 내려 준 그대로 둔다)
    const chat = win.document.querySelector(".app") !== null;
    if (keyboard && chat && (win.scrollY > 0 || vv.offsetTop > 0)) win.scrollTo(0, 0);
  }

  vv.addEventListener("resize", sync);
  vv.addEventListener("scroll", sync);
  sync();
  return () => {
    vv.removeEventListener("resize", sync);
    vv.removeEventListener("scroll", sync);
  };
}
