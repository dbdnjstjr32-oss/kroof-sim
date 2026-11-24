// The document skeleton around index.html (which is authored content-only, the way the Artifact host expects).
// Shared by the dev server and the GitHub Pages build so both render identically in standards mode.

const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='7' fill='%23e69f00'/%3E%3Cg stroke='%23e69f00' stroke-width='2.4' stroke-linecap='round'%3E%3Cpath d='M16 2v4M16 26v4M2 16h4M26 16h4M6 6l3 3M23 23l3 3M6 26l3-3M23 9l3-3'/%3E%3C/g%3E%3C/svg%3E";

export const META = {
  title: 'OASIS 컨테이너 차열 지붕 시뮬레이터 (A·B·C·C′안)',
  description: '6m × 3m × 2.8m 건설현장 컨테이너 휴게실 차열 지붕 설계안 A·B·C·C′ 비교 3D 시뮬레이션 — 태양 위치, 공기층 자연환기, 24시간 강판·실내온도 그래프, 냉방부하·절감률 비교 및 설치·해체 애니메이션.',
};

export function wrap(body, { social = false } = {}) {
  const og = social
    ? `<meta name="description" content="${META.description}">
<meta property="og:type" content="website">
<meta property="og:title" content="${META.title}">
<meta property="og:description" content="${META.description}">
<meta name="theme-color" content="#1b2129">
`
    : '';
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${og}<link rel="icon" href="${FAVICON}">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif;background:#fafaf8}img{max-width:100%}[hidden]{display:none!important}</style>
</head><body>
${body}
</body></html>
`;
}
