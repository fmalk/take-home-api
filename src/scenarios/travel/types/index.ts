export interface Airport {
  iata: string;
  name: string;
  city: string;
  country: string;
}

export interface City {
  name: string;
  country: string;
}

export interface Flight {
  id: string;
  from: string;
  to: string;
  date: string;
  departure: string;
  arrival: string;
  airline: string;
  flightNumber: string;
  price: number;
  available: number;
}
