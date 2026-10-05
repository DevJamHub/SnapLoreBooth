/**
 * Phones, not tablets: iPadOS reports itself as a Mac, and Android tablets leave out "Mobile".
 * A phone is an owner or an employee checking on the booth, never the booth itself.
 */
export const PHONE_UA = /iPhone|iPod|Android.+Mobile|Windows Phone|BlackBerry|Opera Mini|IEMobile/i;
