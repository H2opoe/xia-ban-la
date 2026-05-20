import { FloatingMenuSurface } from './floatingSurfaceModel';

type DonationChannel = {
  id: 'wechat' | 'alipay';
  label: string;
  hint: string;
  className: string;
  qrCodeUrl: string;
  logoUrl: string;
};

const DONATION_CHANNELS: DonationChannel[] = [
  {
    id: 'wechat',
    label: '微信',
    hint: '微信扫一扫',
    className: 'wechat-donation',
    qrCodeUrl: new URL('../../assets/donation-wechat.svg', import.meta.url).href,
    logoUrl: new URL('../../assets/donation-wechat-logo.png', import.meta.url).href
  },
  {
    id: 'alipay',
    label: '支付宝',
    hint: '支付宝扫一扫',
    className: 'alipay-donation',
    qrCodeUrl: new URL('../../assets/donation-alipay.svg', import.meta.url).href,
    logoUrl: new URL('../../assets/donation-alipay-logo.png', import.meta.url).href
  }
];

export function FloatingDonationMenu() {
  return (
    <FloatingMenuSurface id="donation-panel" className="donation-popover">
      <div className="donation-copy">
        <strong>感谢支持下班啦</strong>
        <p>开发不易，感谢你的喜欢和支持。</p>
      </div>
      <div className="donation-qr-grid" aria-label="打赏作者收款码">
        {DONATION_CHANNELS.map((channel) => (
          <section className={['donation-qr-card', channel.className].join(' ')} key={channel.id}>
            <div className="donation-qr-visual">
              <img src={channel.qrCodeUrl} alt={`${channel.label}打赏收款码`} />
              <img className={`donation-qr-logo donation-qr-logo-${channel.id}`} src={channel.logoUrl} alt="" aria-hidden="true" />
            </div>
            <div className="donation-qr-meta">
              <strong>{channel.label}</strong>
              <span>{channel.hint}</span>
            </div>
          </section>
        ))}
      </div>
    </FloatingMenuSurface>
  );
}
