// Fixed demo catalog. Prices are integer US cents so totals never suffer float drift.
// Tags drive dietary constraints ("no pork", "vegetarian", ...). `stock: 0` is a deliberate demo trap.

export const SHIPPING_CENTS = 399;
export const FREE_SHIPPING_OVER_CENTS = 5000;
export const CURRENCY = 'USD';

export const PRODUCTS = [
  // Singles
  { id: 'f01', name: 'Crispy Chicken Nuggets 1 kg', category: 'single', priceCents: 899, serves: 4, stock: 40, tags: ['chicken'], description: 'Breaded chicken nuggets, oven or air-fryer ready.' },
  { id: 'f02', name: 'Chicken Samosas 24 pack', category: 'single', priceCents: 749, serves: 4, stock: 30, tags: ['chicken'], description: 'Spiced chicken samosas, fry or bake.' },
  { id: 'f03', name: 'Beef Seekh Kebab 500 g', category: 'single', priceCents: 999, serves: 3, stock: 25, tags: ['beef'], description: 'Minced beef kebabs with herbs and spices.' },
  { id: 'f04', name: 'Pork Dumplings 40 pack', category: 'single', priceCents: 1049, serves: 4, stock: 25, tags: ['pork'], description: 'Steam or pan-fry pork dumplings.' },
  { id: 'f05', name: 'Veggie Spring Rolls 30 pack', category: 'single', priceCents: 699, serves: 4, stock: 35, tags: ['vegetarian', 'vegan'], description: 'Crispy vegetable spring rolls.' },
  { id: 'f06', name: 'Aloo Paratha 10 pack', category: 'single', priceCents: 549, serves: 4, stock: 50, tags: ['vegetarian'], description: 'Potato-stuffed flatbread.' },
  { id: 'f07', name: 'Cheese Pizza Family Size', category: 'single', priceCents: 799, serves: 4, stock: 20, tags: ['vegetarian', 'dairy'], description: 'Stone-baked style cheese pizza.' },
  { id: 'f08', name: 'Pepperoni Pizza Family Size', category: 'single', priceCents: 849, serves: 4, stock: 20, tags: ['pork'], description: 'Pepperoni and mozzarella pizza.' },
  { id: 'f09', name: 'Fish Fingers 20 pack', category: 'single', priceCents: 799, serves: 4, stock: 30, tags: ['seafood'], description: 'Crumbed white fish fingers.' },
  { id: 'f10', name: 'Shrimp Popcorn 400 g', category: 'single', priceCents: 1199, serves: 3, stock: 0, tags: ['seafood'], description: 'Bite-size breaded shrimp. Currently out of stock.' },
  { id: 'f11', name: 'Mixed Vegetables 1.5 kg', category: 'single', priceCents: 399, serves: 6, stock: 60, tags: ['vegetarian', 'vegan', 'gluten-free'], description: 'Peas, carrots, corn and beans.' },
  { id: 'f12', name: 'French Fries 2 kg', category: 'single', priceCents: 499, serves: 8, stock: 60, tags: ['vegetarian', 'vegan'], description: 'Straight-cut fries.' },
  { id: 'f13', name: 'Chicken Biryani Meal Kit', category: 'single', priceCents: 949, serves: 4, stock: 15, tags: ['chicken'], description: 'Ready-to-heat chicken biryani with raita.' },
  { id: 'f14', name: 'Beef Burger Patties 8 pack', category: 'single', priceCents: 1099, serves: 4, stock: 25, tags: ['beef'], description: 'Quarter-pound beef patties.' },
  { id: 'f15', name: 'Pork Sausages 12 pack', category: 'single', priceCents: 899, serves: 4, stock: 25, tags: ['pork'], description: 'Breakfast pork sausages.' },
  { id: 'f16', name: 'Paneer Tikka 400 g', category: 'single', priceCents: 849, serves: 3, stock: 18, tags: ['vegetarian', 'dairy', 'gluten-free'], description: 'Marinated paneer cubes.' },
  { id: 'f17', name: 'Frozen Berries Mix 1 kg', category: 'single', priceCents: 649, serves: 6, stock: 30, tags: ['vegetarian', 'vegan', 'gluten-free'], description: 'Strawberries, blueberries and raspberries.' },
  { id: 'f18', name: 'Vanilla Ice Cream 2 L', category: 'single', priceCents: 599, serves: 8, stock: 30, tags: ['vegetarian', 'dairy'], description: 'Classic vanilla ice cream tub.' },
  { id: 'f19', name: 'Roti Chapati 20 pack', category: 'single', priceCents: 449, serves: 5, stock: 45, tags: ['vegetarian', 'vegan'], description: 'Whole wheat roti.' },
  { id: 'f20', name: 'Chicken Wings 1 kg', category: 'single', priceCents: 999, serves: 3, stock: 22, tags: ['chicken', 'gluten-free'], description: 'Seasoned chicken wings.' },
  { id: 'f21', name: 'Lamb Keema 500 g', category: 'single', priceCents: 1149, serves: 3, stock: 12, tags: ['lamb'], description: 'Minced lamb for curries.' },
  { id: 'f22', name: 'Veggie Burger Patties 8 pack', category: 'single', priceCents: 899, serves: 4, stock: 25, tags: ['vegetarian', 'vegan'], description: 'Plant-based burger patties.' },

  // Bundles
  { id: 'b01', name: 'Student Bundle (nuggets + fries)', category: 'bundle', priceCents: 1249, serves: 6, stock: 20, tags: ['chicken', 'bundle'], description: 'Crispy Chicken Nuggets 1 kg and French Fries 2 kg.' },
  { id: 'b02', name: 'Veggie Bundle (spring rolls + fries + mixed veg)', category: 'bundle', priceCents: 1399, serves: 8, stock: 20, tags: ['vegetarian', 'vegan', 'bundle'], description: 'Veggie Spring Rolls, French Fries 2 kg and Mixed Vegetables 1.5 kg.' },
  { id: 'b03', name: 'Family Feast Bundle (nuggets + kebab + fries + roti)', category: 'bundle', priceCents: 2299, serves: 10, stock: 15, tags: ['chicken', 'beef', 'bundle'], description: 'Nuggets, Beef Seekh Kebab, French Fries and Roti Chapati.' },
  { id: 'b04', name: 'Seafood Bundle (fish fingers + fries)', category: 'bundle', priceCents: 1349, serves: 6, stock: 18, tags: ['seafood', 'bundle'], description: 'Fish Fingers 20 pack and French Fries 2 kg.' },
  { id: 'b05', name: 'Pork Party Bundle (dumplings + sausages + pizza)', category: 'bundle', priceCents: 2399, serves: 10, stock: 10, tags: ['pork', 'bundle'], description: 'Pork Dumplings, Pork Sausages and Pepperoni Pizza.' },
];

const byId = new Map(PRODUCTS.map((p) => [p.id, p]));

export function getProduct(id) {
  return byId.get(String(id)) ?? null;
}

export function formatCents(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

/** PayPal wants decimal strings with two places. */
export function centsToDecimal(cents) {
  return (cents / 100).toFixed(2);
}

export function shippingFor(itemTotalCents) {
  if (itemTotalCents <= 0) return 0;
  return itemTotalCents >= FREE_SHIPPING_OVER_CENTS ? 0 : SHIPPING_CENTS;
}
