/// <reference types="vite/client" />

export class HexDetailModalLogic {
  private readonly selectedHex: any;
  private readonly map: any;
  private units: any[];
  private cities: any[];

  constructor(selectedHex: any, map: any, units: any[], cities: any[]) {
    this.selectedHex = selectedHex;
    this.map = map;
    this.units = units;
    this.cities = cities;
  }

  getTile(): any {
    if (!this.selectedHex || !this.map) return null;
    const index = this.selectedHex.row * this.map.width + this.selectedHex.col;
    return this.map.tiles[index] || null;
  }

  getUnitsAtHex(): any[] {
    return this.units.filter(u => u.col === this.selectedHex?.col && u.row === this.selectedHex?.row);
  }

  getCityAtHex(): any {
    return this.cities.find(c => c.col === this.selectedHex?.col && c.row === this.selectedHex?.row);
  }

  getTileType(): string {
    const tile = this.getTile();
    return tile?.type || 'Unknown';
  }

  getTileResource(): string {
    const tile = this.getTile();
    return tile?.resource || 'None';
  }

  getTileImprovement(): string {
    const tile = this.getTile();
    return tile?.improvement || 'None';
  }
}