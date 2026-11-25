const GROUPED = { '.': /^\d{1,3}(\.\d{3})+$/, ',': /^\d{1,3}(,\d{3})+$/ };

/** Number format used to type each currency: BRL 1.234,56 · USD 1,234.56 · EUR 1.234,56. */
const LOCALES: Record<string, string> = { BRL: 'pt-BR', USD: 'en-US', EUR: 'de-DE' };
export type Separator = ',' | '.';
export const amountLocale = (currency: string) => LOCALES[currency] ?? 'pt-BR';
export function decimalSeparator(currency: string): Separator {
  const part = new Intl.NumberFormat(amountLocale(currency)).formatToParts(1.5).find(p => p.type === 'decimal');
  return part?.value === '.' ? '.' : ',';
}
/** Formats an amount in cents in the currency's typing format, always with 2 decimals (no symbol). */
export const formatCents = (cents: number, currency: string) =>
  new Intl.NumberFormat(amountLocale(currency), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    cents / 100,
  );

/**
 * Parses a money amount typed or pasted by the user. `decimal` is the separator of the selected currency
 * ("," for BRL/EUR, "." for USD); the other separator is accepted only as thousands grouping. Examples (BRL):
 * "1.234,56", "40,00", "1.234", "R$ 1.500"; (USD): "1,234.56", "12.5", "1,234". Also accepts the other
 * format when unambiguous ("1234.56" in BRL, "40,00" in USD).
 * Returns null when it is not a valid amount for the API: 0 to 1 000 000 000 with at most 2 decimals.
 */
export function parseAmount(text: string, decimal: Separator = ','): number | null {
  let value = text.replace(/\s/g, '').replace(/^(R\$|US\$|\$|€)/i, '');
  if (!/^\d[\d.,]*$/.test(value)) return null;
  const comma = value.lastIndexOf(','),
    dot = value.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    // Both present: the last one is the decimal separator; the other must group thousands.
    const last: Separator = comma > dot ? ',' : '.',
      group: Separator = last === ',' ? '.' : ',';
    const parts = value.split(last);
    if (parts.length !== 2 || !GROUPED[group].test(parts[0])) return null;
    value = parts[0].split(group).join('') + '.' + parts[1];
  } else if (comma >= 0 || dot >= 0) {
    const sep: Separator = comma >= 0 ? ',' : '.';
    const single = value.indexOf(sep) === value.lastIndexOf(sep);
    if (sep !== decimal && GROUPED[sep].test(value))
      value = value.split(sep).join(''); // thousands: "1.234" (BRL)
    else if (single)
      value = value.replace(sep, '.'); // decimal: "40,00" (BRL), "12.5" (USD)
    else return null;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount <= 1e9 ? amount : null;
}
