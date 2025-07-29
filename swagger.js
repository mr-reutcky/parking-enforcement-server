const swaggerJsDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');


const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Parking Enforcement API",
      version: "1.0.0",
      description: "API documentation for license plate detection and permit validation",
    },
  },
  apis: ["./server.js"], // or you can include route files too
};

const swaggerSpec = swaggerJsDoc(swaggerOptions);

module.exports = swaggerSpec;
