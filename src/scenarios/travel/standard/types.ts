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
  localCurrency: string;
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
  hull: 'small' | 'medium' | 'large';
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

export interface FlightPricing {
  currency: string;
  available: number;
  regular?: number;
  economy?: number;
  businessClass?: number;
  firstClass?: number;
}

export interface RoutePricing {
  currency: string;
  available: number;
  minimum: number; // the minimum price allowing a seat to be bought for every leg
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
  pricing: FlightPricing[];
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
  pricing: RoutePricing[];
}

// Generic over the route shape so callers can plug in Route (raw) or FormattedRoute
// (API-facing) instead of duplicating this shape per representation.
export interface SearchResults<R = Route> {
  id: string;
  mode: 'OneWay' | 'RoundTrip';
  outbound: R[];
  inbound?: R[]; // only present when mode is 'RoundTrip'
}