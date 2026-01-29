'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Box, Typography, Button, Paper, TextField, Alert } from '@mui/material';
import { ArrowBack, Save } from '@mui/icons-material';

export default function CalibrationPage() {
    const params = useParams();
    const router = useRouter();
    const appraisalId = params.appraisalId as string;

    return (
        <Box>
            <Button startIcon={<ArrowBack />} onClick={() => router.push(`/appraisals/${appraisalId}`)} sx={{ mb: 2 }}>
                Back to Appraisal
            </Button>

            <Paper sx={{ p: 4 }}>
                <Typography variant="h5" gutterBottom>Calibration</Typography>
                <Alert severity="info" sx={{ mb: 3 }}>
                    This phase is for HR and Managers to calibrate ratings across the organization.
                </Alert>

                <Box sx={{ mt: 3 }}>
                    <Typography variant="body1">Calibration features coming soon.</Typography>
                </Box>
            </Paper>
        </Box>
    );
}
