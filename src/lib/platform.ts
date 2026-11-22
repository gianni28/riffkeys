/** En iPhone, filtrar por extensión deja grises los .gp (iOS no conoce el tipo): ahí se acepta todo. */
export const IOS = typeof navigator !== "undefined" && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/** Enlaces de búsqueda: Riffkeys no descarga tabs por su cuenta, pero te deja a un toque del archivo. */
export function searchLinks(q: string) {
  const enc = encodeURIComponent(q.trim());
  return {
    // type=500 filtra los resultados de Ultimate Guitar a archivos Guitar Pro.
    guitarPro: `https://www.ultimate-guitar.com/search.php?search_type=title&value=${enc}&type=500`,
    songsterr: `https://www.songsterr.com/?pattern=${enc}`,
    youtube: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${q.trim()} piano`)}`,
  };
}
