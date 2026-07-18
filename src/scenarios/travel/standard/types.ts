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
  regular: number;
  economy?: number;
  businessClass?: number;
  firstClass?: number;
}

export interface Seats {
  regular: number;
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
    plane: string;
    flightNumber: string;
  };
  price: number; // simpler scenarios
  pricing: [Pricing];
  available: number;
  seats: [Seats];
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
  flights: [Flight];
  available: number;
  price: number; // simpler scenarios
  pricing: [Pricing];
}
