import { faker } from '@faker-js/faker';
import type { Flight } from '../../../types/index.js';

const AIRLINES = ['United', 'American', 'Delta', 'Southwest', 'JetBlue', 'Alaska', 'Spirit'];

export function generateFlightId(from: string, to: string, date: string, index: number): string {
    return `${from.toLowerCase()}-${to.toLowerCase()}-${date}-${index}`;
}

export function generateFlights(from: string, to: string, date: string, count: number = 5): Flight[] {
    faker.seed(hashFlightQuery(from, to, date));

    const flights: Flight[] = [];

    for (let i = 0; i < count; i++) {
        const airline = faker.helpers.arrayElement(AIRLINES);
        const flightNumber = faker.string.numeric(4);
        const departureHour = faker.number.int({ min: 6, max: 22 });
        const departureMinute = faker.helpers.arrayElement([0, 15, 30, 45]);
        const flightDuration = faker.number.int({ min: 180, max: 480 });

        const departure = `${String(departureHour).padStart(2, '0')}:${String(departureMinute).padStart(2, '0')}`;
        const arrivalTime = new Date();
        arrivalTime.setHours(departureHour);
        arrivalTime.setMinutes(departureMinute + flightDuration);
        const arrivalHour = arrivalTime.getHours();
        const arrivalMinute = arrivalTime.getMinutes();
        const arrival = `${String(arrivalHour).padStart(2, '0')}:${String(arrivalMinute).padStart(2, '0')}`;

        const price = faker.number.int({ min: 100, max: 800 });
        const available = faker.number.int({ min: 5, max: 180 });

        flights.push({
            id: generateFlightId(from, to, date, i),
            from,
            to,
            date,
            departure,
            arrival,
            airline,
            flightNumber: `${airline.substring(0, 2).toUpperCase()}${flightNumber}`,
            price,
            available,
        });
    }

    return flights;
}

function hashFlightQuery(from: string, to: string, date: string): number {
    const str = `${from}|${to}|${date}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
    }
    return Math.abs(hash);
}
