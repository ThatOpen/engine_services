import { describe, it, expect } from 'vitest';
import { RequestError } from './request-error';

describe('RequestError', () => {
  it('extracts message, code and details from a structured JSON body', () => {
    const body = JSON.stringify({
      message: 'Components limit reached (10/10).',
      code: 'LIMIT_EXCEEDED',
      details: { limitType: 'componentsPerAccount', current: 10, max: 10 },
    });
    const err = new RequestError(403, 'Forbidden', body);
    expect(err.status).toBe(403);
    expect(err.code).toBe('LIMIT_EXCEEDED');
    expect(err.details).toEqual({
      limitType: 'componentsPerAccount',
      current: 10,
      max: 10,
    });
    expect(err.message).toBe('Components limit reached (10/10).');
    expect(err.body).toBe(body);
  });

  it('leaves code and details undefined when the body has only a message', () => {
    const err = new RequestError(404, 'Not Found', JSON.stringify({
      message: 'Item not found',
    }));
    expect(err.message).toBe('Item not found');
    expect(err.code).toBeUndefined();
    expect(err.details).toBeUndefined();
  });

  it('falls back to a status line when the body is not JSON', () => {
    const err = new RequestError(502, 'Bad Gateway', '<html>error</html>');
    expect(err.message).toBe('Bad Gateway (502)');
    expect(err.code).toBeUndefined();
    expect(err.details).toBeUndefined();
    expect(err.body).toBe('<html>error</html>');
  });

  it('falls back to a status line for an empty body', () => {
    const err = new RequestError(500, 'Internal Server Error', '');
    expect(err.message).toBe('Internal Server Error (500)');
  });

  it('falls back when the JSON body is not an object', () => {
    const err = new RequestError(400, 'Bad Request', '"just a string"');
    expect(err.message).toBe('Bad Request (400)');
    expect(err.code).toBeUndefined();
  });

  it('ignores non-string message and code fields', () => {
    const err = new RequestError(400, 'Bad Request', JSON.stringify({
      message: 123,
      code: { nested: true },
    }));
    expect(err.message).toBe('Bad Request (400)');
    expect(err.code).toBeUndefined();
  });

  it('is an instance of Error and RequestError with the right name', () => {
    const err = new RequestError(403, 'Forbidden', '');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RequestError);
    expect(err.name).toBe('RequestError');
  });
});
