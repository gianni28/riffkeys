/** Enlaces de búsqueda: tabs gratis en texto para copiar y pegar en Riffkeys. */
export function searchLinks(q: string) {
  const enc = encodeURIComponent(q.trim());
  return {
    // type=200 filtra Ultimate Guitar a tabs en texto: se ven gratis y se pueden copiar.
    tabs: `https://www.ultimate-guitar.com/search.php?search_type=title&value=${enc}&type=200`,
    youtube: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${q.trim()} piano`)}`,
  };
}
