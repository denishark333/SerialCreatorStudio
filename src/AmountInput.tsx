import { useLayoutEffect, useRef, useState, type ChangeEvent } from 'react';
import { decimalSeparator, formatCents, parseAmount } from './money';

const MAX_CENTS = 100_000_000_000; // 1 000 000 000.00 — same limit as the API

/**
 * Money field with a mask that follows the selected currency (BRL/EUR "1.000,00", USD "1,000.00").
 * Typed digits fill from the right (1 → 0,01 · 100000 → 1.000,00); separators are inserted automatically.
 * Pasted text and browser autofill ("40,00", "1.234,56") are interpreted as a whole.
 * The exact value is submitted in a hidden field named `valueName` (e.g. "1234.56"); "" when empty.
 */
export function AmountInput({
  name,
  valueName,
  currency,
  required,
}: {
  name: string;
  valueName: string;
  currency: string;
  required?: boolean;
}) {
  const [cents, setCents] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const text = cents === null ? '' : formatCents(cents, currency);

  // Keep the caret at the end, where digits are entered.
  useLayoutEffect(() => {
    const el = input.current;
    if (el && document.activeElement === el) el.setSelectionRange(el.value.length, el.value.length);
  }, [text]);

  function change(event: ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    const kind = (event.nativeEvent as InputEvent).inputType ?? '';
    const typing = kind === 'insertText' || kind.startsWith('delete');
    let next: number | null;
    if (typing) {
      const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
      next = digits ? Number(digits) : null;
    } else {
      // Paste, drop or autofill: interpret the full value in the selected currency; fall back to its digits.
      const parsed = parseAmount(raw, decimalSeparator(currency));
      const digits = raw.replace(/\D/g, '');
      next = parsed !== null ? Math.round(parsed * 100) : digits ? Number(digits) : null;
    }
    if (next !== null && next > MAX_CENTS) return; // ignore input beyond the limit
    setCents(next);
  }

  return (
    <>
      <input
        ref={input}
        name={name}
        type="text"
        inputMode="numeric"
        placeholder={formatCents(0, currency)}
        required={required}
        value={text}
        onChange={change}
      />
      <input type="hidden" name={valueName} value={cents === null ? '' : (cents / 100).toFixed(2)} />
    </>
  );
}
