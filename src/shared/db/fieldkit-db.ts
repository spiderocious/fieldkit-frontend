// The app's database: the offline core's four stores plus visits and photos.
import type { Table } from 'dexie';

import { OfflineDatabase } from '@shared/offline';

/** A visit as the device knows it. Mirrors the server shape plus local state. */
export interface LocalVisit {
  id: string;
  agent_id: string;
  shop_name: string;
  owner_name: string;
  phone: string;
  lat: number | null;
  lng: number | null;
  /** 0 until the server has accepted it. */
  version: number;
  photo_count: number;
  captured_at: string;
  created_at: string;
  updated_at: string;
}

/** A photo captured on this device. The bytes live in OPFS or IndexedDB. */
export interface LocalPhoto {
  id: string;
  visit_id: string;
  bytes: number;
  width: number;
  height: number;
  /** Set once the server has it. */
  uploaded_at: string | null;
  created_at: string;
}

export class FieldkitDb extends OfflineDatabase {
  declare visits: Table<LocalVisit, string>;
  declare photos: Table<LocalPhoto, string>;

  constructor(name = 'fieldkit') {
    super(name, {
      visits: 'id, captured_at, created_at, version',
      photos: 'id, visit_id, uploaded_at',
    });
  }
}
