import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Icon } from './Icon';

/** QR codes are generated in the browser from the short URL — no third-party QR service sees your links. */
export function QrCode({ url, code }: { url: string; code: string }) {
  const [png, setPng] = useState<string | null>(null);
  const [svgHref, setSvgHref] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    Promise.all([
      QRCode.toDataURL(url, { width: 512, margin: 2, errorCorrectionLevel: 'M' }),
      QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }),
    ]).then(([p, s]) => {
      if (!live) return;
      objectUrl = URL.createObjectURL(new Blob([s], { type: 'image/svg+xml' }));
      setPng(p); setSvgHref(objectUrl);
    }).catch(() => live && setError(true));
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);
  if (error) return <p className="field-error">Could not generate a QR code.</p>;
  if (!png) return <div className="skeleton" style={{ width: 200, height: 200 }} />;
  return (
    <div className="qr-box">
      <img src={png} alt={`QR code for ${url}`} />
      <div className="row wrap" style={{ justifyContent: 'center' }}>
        <a className="btn secondary sm" href={png} download={`linkpulse-${code}.png`}><Icon name="download" size={15} />PNG</a>
        {svgHref && <a className="btn secondary sm" href={svgHref} download={`linkpulse-${code}.svg`}><Icon name="download" size={15} />SVG</a>}
      </div>
      <p className="hint" style={{ textAlign: 'center' }}>Scans count as clicks and follow the same password, expiry and limit rules.</p>
    </div>
  );
}
