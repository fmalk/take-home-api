export interface FlightSearchParams {
    from: string;
    to: string;
    date: string;
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
}

export interface Airport {
    iata: string;
    icao: string|null;
    name: string;
    city: string;
    country: string;
}