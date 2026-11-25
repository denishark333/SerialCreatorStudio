import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount } from '../src/money.ts';

test('pt-BR amounts, including the browser autofill format ("40,00")', () => {
  assert.equal(parseAmount('40,00'), 40);
  assert.equal(parseAmount('3,5'), 3.5);
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount('1.234.567,89'), 1234567.89);
  assert.equal(parseAmount('1.234'), 1234);
  assert.equal(parseAmount('R$ 1.500'), 1500);
  assert.equal(parseAmount(' 1 234,50 '), 1234.5);
});

test('international amounts', () => {
  assert.equal(parseAmount('1234.56'), 1234.56);
  assert.equal(parseAmount('12.5'), 12.5);
  assert.equal(parseAmount('1,234.56'), 1234.56);
  assert.equal(parseAmount('US$ 250'), 250);
  assert.equal(parseAmount('0'), 0);
});

test('invalid or out-of-range values are rejected (same rules as the API)', () => {
  for (const value of [
    '',
    'abc',
    '-5',
    '1,2,3',
    '1.2,3',
    '12,345,6',
    '1,234,567',
    '10,999',
    '1.5.0',
    '2000000000',
    '1e3',
    ',',
  ])
    assert.equal(parseAmount(value), null, value);
});

test('USD uses "." as decimal separator and "," for thousands', async () => {
  assert.equal(parseAmount('1,234.56', '.'), 1234.56);
  assert.equal(parseAmount('12.5', '.'), 12.5);
  assert.equal(parseAmount('1,234', '.'), 1234);
  assert.equal(parseAmount('1,234,567.89', '.'), 1234567.89);
  assert.equal(parseAmount('40,00', '.'), 40); // old pt-BR autofill entry, unambiguous
  assert.equal(parseAmount('1.234', '.'), null); // 3 decimals in USD
  assert.equal(parseAmount('1.234.567', '.'), null);
});

test('typing format per currency', async () => {
  const { formatCents, decimalSeparator } = await import('../src/money.ts');
  assert.equal(formatCents(100000, 'BRL'), '1.000,00');
  assert.equal(formatCents(100000, 'USD'), '1,000.00');
  assert.equal(formatCents(123456789, 'EUR'), '1.234.567,89');
  assert.equal(formatCents(1, 'BRL'), '0,01');
  assert.deepEqual(['BRL', 'USD', 'EUR'].map(decimalSeparator), [',', '.', ',']);
});
