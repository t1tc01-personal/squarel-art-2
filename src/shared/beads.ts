/**
 * Fuse-bead color tables. Hex values are close approximations of the
 * manufacturers' colors (official values are not published as sRGB);
 * check against a physical color chart before buying beads.
 */
export interface BeadColor {
  code: string
  name: string
  hex: string
}

export const BEAD_BRANDS: Record<'perler' | 'hama', BeadColor[]> = {
  perler: [
    { code: 'P01', name: 'White', hex: '#f1f1f1' },
    { code: 'P02', name: 'Cream', hex: '#e0dbb0' },
    { code: 'P03', name: 'Yellow', hex: '#ecd800' },
    { code: 'P04', name: 'Orange', hex: '#ed6120' },
    { code: 'P05', name: 'Red', hex: '#bf2633' },
    { code: 'P06', name: 'Bubblegum', hex: '#dd6a9a' },
    { code: 'P07', name: 'Purple', hex: '#5f3e8a' },
    { code: 'P08', name: 'Dark Blue', hex: '#2b3f87' },
    { code: 'P09', name: 'Light Blue', hex: '#3384c5' },
    { code: 'P10', name: 'Dark Green', hex: '#1c753e' },
    { code: 'P11', name: 'Light Green', hex: '#56ba9f' },
    { code: 'P12', name: 'Brown', hex: '#513a35' },
    { code: 'P17', name: 'Grey', hex: '#8a8d91' },
    { code: 'P18', name: 'Black', hex: '#2e2f32' },
    { code: 'P20', name: 'Rust', hex: '#8c372b' },
    { code: 'P21', name: 'Light Brown', hex: '#815d34' },
    { code: 'P33', name: 'Peach', hex: '#eebaa8' },
    { code: 'P35', name: 'Tan', hex: '#cba57c' },
    { code: 'P38', name: 'Magenta', hex: '#f22d7b' },
    { code: 'P52', name: 'Pastel Blue', hex: '#6699d4' },
    { code: 'P53', name: 'Pastel Green', hex: '#88d488' },
    { code: 'P54', name: 'Pastel Lavender', hex: '#a28dc2' },
    { code: 'P56', name: 'Pastel Yellow', hex: '#fff27e' },
    { code: 'P57', name: 'Cheddar', hex: '#f1aa0c' },
    { code: 'P59', name: 'Hot Coral', hex: '#ff3956' },
    { code: 'P61', name: 'Kiwi Lime', hex: '#6cbe13' },
    { code: 'P62', name: 'Turquoise', hex: '#2b89c6' },
    { code: 'P79', name: 'Light Pink', hex: '#f5c0d4' },
    { code: 'P83', name: 'Pink', hex: '#e44f94' },
    { code: 'P92', name: 'Dark Grey', hex: '#4d5156' },
  ],
  hama: [
    { code: 'H01', name: 'White', hex: '#ececec' },
    { code: 'H02', name: 'Cream', hex: '#f0e8b9' },
    { code: 'H03', name: 'Yellow', hex: '#f0b901' },
    { code: 'H04', name: 'Orange', hex: '#e64f27' },
    { code: 'H05', name: 'Red', hex: '#b63136' },
    { code: 'H06', name: 'Pink', hex: '#e1889f' },
    { code: 'H07', name: 'Purple', hex: '#694a82' },
    { code: 'H08', name: 'Blue', hex: '#2c4690' },
    { code: 'H09', name: 'Light Blue', hex: '#305cb0' },
    { code: 'H10', name: 'Green', hex: '#256847' },
    { code: 'H11', name: 'Light Green', hex: '#49ae89' },
    { code: 'H12', name: 'Brown', hex: '#534137' },
    { code: 'H17', name: 'Grey', hex: '#83888a' },
    { code: 'H18', name: 'Black', hex: '#2e2f31' },
    { code: 'H20', name: 'Reddish Brown', hex: '#7f332a' },
    { code: 'H21', name: 'Light Brown', hex: '#a5693f' },
    { code: 'H22', name: 'Dark Red', hex: '#a52d36' },
    { code: 'H26', name: 'Flesh', hex: '#de8c7a' },
    { code: 'H27', name: 'Beige', hex: '#deb58b' },
    { code: 'H28', name: 'Dark Green', hex: '#363f38' },
    { code: 'H29', name: 'Claret', hex: '#b9395e' },
    { code: 'H30', name: 'Burgundy', hex: '#682b3f' },
    { code: 'H31', name: 'Turquoise', hex: '#6797ae' },
    { code: 'H43', name: 'Pastel Yellow', hex: '#f3f27c' },
    { code: 'H44', name: 'Pastel Red', hex: '#f35b6a' },
    { code: 'H45', name: 'Pastel Purple', hex: '#8e6ec0' },
    { code: 'H46', name: 'Pastel Blue', hex: '#75c1f2' },
    { code: 'H47', name: 'Pastel Green', hex: '#8fd88a' },
    { code: 'H48', name: 'Pastel Pink', hex: '#e8a3c6' },
    { code: 'H60', name: 'Teddy Bear Brown', hex: '#b38a3b' },
  ],
}

export type BeadBrand = keyof typeof BEAD_BRANDS
