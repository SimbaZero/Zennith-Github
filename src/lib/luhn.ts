// ---------------------------------------------------------------------------
// Luhn (mod 10) checksum — the algorithm behind the final digit of a South
// African ID number (and credit card numbers). It catches almost all single
// mistyped digits and most swapped neighbouring digits, so an ID that fails
// it was almost certainly typed wrong.
//
// It only proves the number is well-formed, NOT that it was issued to a real
// person — that would need a Home Affairs lookup.
// ---------------------------------------------------------------------------

/** True if the digit string passes the Luhn checksum. */
export function passesLuhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;

  let sum = 0;
  // Walk from the rightmost digit (the check digit) leftwards, doubling
  // every second digit. A doubled value over 9 has 9 subtracted, which is
  // the same as adding its two digits together (e.g. 16 → 1 + 6 = 7).
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}
