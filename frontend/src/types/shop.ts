export interface Shop {
  id: number;
  platform: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface ShopCreateInput {
  platform: string;
  name: string;
}

export interface ShopUpdateInput {
  name?: string;
  is_active?: boolean;
  platform?: string;
}
