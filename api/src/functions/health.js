const { app } = require('@azure/functions');

// GET /api/health
// Confirms the Azure Functions API itself is up. No database call here.
app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async (request, context) => {
    return {
      jsonBody: {
        success: true,
        message: 'Azure Functions API is running',
      },
    };
  },
});
