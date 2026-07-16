import type { Flight } from '../../../types/index.js';

export class TravelStore {
    constructor() {}

    getFlight(flights: Flight[], id: string): Flight | undefined {
        return flights.find((f) => f.id === id);
    }

    searchFlights(flights: Flight[], from: string, to: string, date: string): Flight[] {
        return flights.filter((f) => f.from === from && f.to === to && f.date === date);
    }
}
