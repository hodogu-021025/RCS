// 전화번호를 누르면 전화를 건다 (가게 전화번호: 채팅 카드·자막 카드·내 주문)
export function TelLink({ phone }: { phone: string }) {
  return (
    <a className="tel-link" href={`tel:${phone.replace(/\D/g, "")}`}>
      {phone}
    </a>
  );
}
