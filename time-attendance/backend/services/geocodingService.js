/**
 * Geocoding Service
 * 
 * Reverse geocodes coordinates to human-readable addresses using OpenStreetMap Nominatim API.
 * Free service with usage policy: max 1 request per second, include user-agent.
 */

const https = require('https');

// Cache to avoid repeated lookups for same coordinates
const addressCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Reverse geocode coordinates to an address
 * @param {number} latitude 
 * @param {number} longitude 
 * @returns {Promise<{address: string, area: string, city: string, country: string, displayName: string} | null>}
 */
async function reverseGeocode(latitude, longitude) {
    if (!latitude || !longitude) {
        return null;
    }

    // Round to 5 decimal places for cache key (about 1m precision)
    const cacheKey = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
    
    // Check cache first
    const cached = addressCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }

    try {
        const result = await new Promise((resolve, reject) => {
            const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`;
            
            const options = {
                headers: {
                    'User-Agent': 'Seemplify-TimeAttendance/1.0 (contact@seemplify.app)',
                    'Accept-Language': 'en',
                },
            };

            https.get(url, options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        resolve(json);
                    } catch (e) {
                        reject(e);
                    }
                });
            }).on('error', reject);
        });

        if (result && result.address) {
            const addr = result.address;
            
            // Build a clean address string
            const parts = [];
            
            // Street address
            if (addr.house_number && addr.road) {
                parts.push(`${addr.house_number} ${addr.road}`);
            } else if (addr.road) {
                parts.push(addr.road);
            } else if (addr.building || addr.amenity) {
                parts.push(addr.building || addr.amenity);
            }
            
            // Area/suburb
            const area = addr.suburb || addr.neighbourhood || addr.quarter || addr.district || '';
            
            // City
            const city = addr.city || addr.town || addr.village || addr.municipality || '';
            
            // State/region
            const state = addr.state || addr.region || '';
            
            // Country
            const country = addr.country || '';

            // Build display name
            if (area) parts.push(area);
            if (city) parts.push(city);
            
            const addressData = {
                address: parts.join(', ') || result.display_name?.split(',').slice(0, 3).join(', ') || `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
                area: area,
                city: city,
                state: state,
                country: country,
                displayName: result.display_name || '',
            };

            // Cache the result
            addressCache.set(cacheKey, {
                data: addressData,
                timestamp: Date.now(),
            });

            return addressData;
        }

        return null;
    } catch (error) {
        console.warn('Reverse geocoding failed:', error.message);
        return null;
    }
}

/**
 * Enrich location object with address data
 * @param {Object} location - Location with latitude, longitude, accuracy
 * @returns {Promise<Object>} - Enhanced location with address fields
 */
async function enrichLocationWithAddress(location) {
    if (!location || !location.latitude || !location.longitude) {
        return location;
    }

    try {
        const geocoded = await reverseGeocode(location.latitude, location.longitude);
        
        if (geocoded) {
            return {
                ...location,
                address: geocoded.address,
                area: geocoded.area,
                city: geocoded.city,
                state: geocoded.state,
                country: geocoded.country,
                displayName: geocoded.displayName,
            };
        }
    } catch (error) {
        console.warn('Failed to enrich location with address:', error.message);
    }

    return location;
}

module.exports = {
    reverseGeocode,
    enrichLocationWithAddress,
};
