'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Box, Typography, Button, Paper, Alert } from '@mui/material';
import { ArrowBack, CheckCircle } from '@mui/icons-material';

export default function FinalReviewPage() {
    const params = useParams();
    const router = useRouter();
    const appraisalId = params.appraisalId as string;

    return (
        <Box>
            <Button startIcon={<ArrowBack />} onClick={() => router.push(`/appraisals/${appraisalId}`)} sx={{ mb: 2 }}>
                Back to Appraisal
            </Button>

            <Paper sx={{ p: 4 }}>
                <Typography variant="h5" gutterBottom>Final Review</Typography>
                <Alert severity="info" sx={{ mb: 3 }}>
                    Review the final ratings and comments before closing the appraisal cycle.
                </Alert>

                <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                    <Button variant="contained" color="success" startIcon={<CheckCircle />}>
                        Complete Appraisal
                    </Button>
                </Box>
            </Paper>
        </Box>
    );
}
