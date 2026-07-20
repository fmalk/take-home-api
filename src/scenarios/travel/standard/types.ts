export interface City {
  name: string;
  country: string;
  countryCode: string;
}

export interface Airport {
  iata: string;
  icao: string;
  name: string;
  city: string;
  country: string;
  countryCode: string;
  utcOffset: number;
  lat: number;
  long: number;
  isStandard: boolean;
  isRegional: boolean;
  isHub: boolean;
  isIsolated: boolean;
}

export interface Aircraft {
  manufacturer: string;
  model: string;
  type: 'small' | 'medium' | 'large';
  capacity: number;
}

export interface Airline {
  iata: string;
  icao: string;
  name: string;
  country: string;
  countryCode: string;
  hasEconomyClass: boolean;
  hasBusinessClass: boolean;
  hasFirstClass: boolean;
  hasLoyaltyProgram: boolean;
}

export interface Pricing {
  currency: string;
  available: number;
  regular?: number;
  economy?: number;
  businessClass?: number;
  firstClass?: number;
}

export interface Flight {
  id: string;
  flightTimeHours: number;
  flightDistanceKms: number;
  departure: {
    timestamp: string;
    airport: string;
  };
  arrival: {
    timestamp: string;
    airport: string;
  };
  travelInfo: {
    airline: string;
    aircraft: string;
    flightNumber: string;
  };
  available: number;
  price: number; // simpler scenarios
  pricing: Pricing[];
}

export interface Route {
  id: string;
  flightTimeHours: number;
  flightDistanceKms: number;
  departure: {
    timestamp: string;
    airport: string;
  };
  arrival: {
    timestamp: string;
    airport: string;
  };
  flights: Flight[];
  available: number;
  price: number; // simpler scenarios
  pricing: Pricing[];
}
