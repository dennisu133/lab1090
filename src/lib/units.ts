/**
 * Aviation's units in SI. All exact by definition, not measured: the international foot
 * and nautical mile were fixed in metres (1959 and 1929), and the knot is a nautical mile
 * per hour. ICAO Annex 5 lists them as the non-SI units allowed alongside SI.
 */

/** The international foot, m (1959 international yard and pound agreement: 1 yd = 0.9144 m). */
export const FT = 0.3048;

/** The international nautical mile, m (1929; originally a minute of latitude). */
export const NM = 1852;

/** Kilometres per nautical mile: 1.852. */
export const KM_PER_NM = NM / 1000;

/** The knot, m/s: one nautical mile per hour, 1852/3600 = 0.5144 m/s. */
export const KT = NM / 3600;
