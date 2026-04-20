function formatPrice(amount, currency = 'ETB') {
  return `${Number(amount).toLocaleString('en-ET')} ${currency}`;
}

function levenshteinDistance(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b[i - 1] === a[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function truncate(str, maxLen = 100) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}

function isAmharic(text) {
  const amharicChars = (text.match(/[\u1200-\u137F]/g) || []).length;
  return amharicChars / Math.max(text.length, 1) > 0.3;
}

module.exports = { formatPrice, levenshteinDistance, sleep, truncate, isAmharic };
