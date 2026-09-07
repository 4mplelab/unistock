export interface ItemInfo {
  item_id: string;
  title: string;
  stock: number;
}

export interface ItemOptionChoice {
  option_variation_id: string;
  variation_name: string;
  price: number;
}

export interface ItemOption {
  option_id: string;
  option_name: string;
  choices: ItemOptionChoice[];
}

export interface ItemVariation {
  variation_id: string;
  variation_name: string;
  stock: number;
}
