const AppError = require("./AppError");

/** Express middleware factory: validates req.body against a zod schema, replacing it with the parsed result. */
function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
      return next(new AppError("Validation failed", 400, details));
    }
    req.body = result.data;
    next();
  };
}

module.exports = { validateBody };
