const { AttendancePolicy } = require('../models');

/**
 * Geofence Service
 * 
 * Validates if a location (GPS coordinates) is within allowed office areas.
 * Uses Haversine formula to calculate distance between two lat/lng points.
 */

/**
 * Calculate distance between two geographic points using Haversine formula
 * @param {number} lat1 - Latitude of point 1 (degrees)
 * @param {number} lng1 - Longitude of point 1 (degrees)
 * @param {number} lat2 - Latitude of point 2 (degrees)
 * @param {number} lng2 - Longitude of point 2 (degrees)
 * @returns {number} Distance in meters
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371e3; // Earth's radius in meters
    
    // Convert degrees to radians
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lng2 - lng1) * Math.PI) / 180;
    
    // Haversine formula
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    const distance = R * c; // Distance in meters
    return distance;
}

/**
 * Validate if a location is within allowed geofenced areas
 * @param {number} lat - User's latitude
 * @param {number} lng - User's longitude
 * @param {string} organizationId - Organization ID
 * @returns {Object} Validation result with isValid, location, distance, reason
 */
async function validateLocation(lat, lng, organizationId) {
    try {
        // Input validation
        if (typeof lat !== 'number' || typeof lng !== 'number') {
            return {
                isValid: false,
                reason: 'Invalid coordinates',
                code: 'INVALID_COORDINATES'
            };
        }

        // Check lat/lng ranges
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            return {
                isValid: false,
                reason: 'Coordinates out of range',
                code: 'COORDINATES_OUT_OF_RANGE'
            };
        }

        // Get organization's attendance policy
        const policy = await AttendancePolicy.findOne({ organizationId });
        
        if (!policy) {
            // No policy = allow (default permissive)
            return {
                isValid: true,
                reason: 'No policy configured'
            };
        }

        // Check if geofencing is enabled
        if (!policy.geofencing?.enabled) {
            return {
                isValid: true,
                reason: 'Geofencing disabled'
            };
        }

        // Get active geofence locations
        const activeLocations = (policy.geofencing.locations || []).filter(loc => loc.isActive);
        
        if (activeLocations.length === 0) {
            // No locations configured = allow (can't enforce without locations)
            return {
                isValid: true,
                reason: 'No geofence locations configured'
            };
        }

        // Check each location to see if user is within range
        let closestLocation = null;
        let closestDistance = Infinity;

        for (const location of activeLocations) {
            const distance = haversineDistance(
                lat,
                lng,
                location.latitude,
                location.longitude
            );

            // Track closest location for error messaging
            if (distance < closestDistance) {
                closestDistance = distance;
                closestLocation = location;
            }

            // Check if within this location's radius
            if (distance <= location.radius) {
                return {
                    isValid: true,
                    location: location.name,
                    address: location.address,
                    distance: Math.round(distance),
                    message: `Within ${location.name} (${Math.round(distance)}m away)`
                };
            }
        }

        // Not within any location
        const distanceOutside = Math.round(closestDistance - closestLocation.radius);
        
        return {
            isValid: false,
            nearestLocation: closestLocation.name,
            nearestAddress: closestLocation.address,
            distance: Math.round(closestDistance),
            distanceOutside,
            reason: `Outside allowed area. You are ${Math.round(closestDistance)}m from ${closestLocation.name} (allowed radius: ${closestLocation.radius}m)`,
            code: 'OUTSIDE_GEOFENCE'
        };
    } catch (error) {
        console.error('Geofence validation error:', error);
        // On error, default to allowing (permissive fallback)
        return {
            isValid: true,
            reason: 'Validation error (allowed by default)',
            error: error.message
        };
    }
}

/**
 * Check if geofencing is enforced for an organization
 * @param {string} organizationId - Organization ID
 * @returns {Promise<boolean>} True if enforced, false otherwise
 */
async function isGeofencingEnforced(organizationId) {
    try {
        const policy = await AttendancePolicy.findOne({ organizationId });
        return policy?.geofencing?.enabled && policy?.geofencing?.enforced;
    } catch (error) {
        console.error('Check geofencing enforcement error:', error);
        return false; // Default to not enforced on error
    }
}

module.exports = {
    haversineDistance,
    validateLocation,
    isGeofencingEnforced,
};
