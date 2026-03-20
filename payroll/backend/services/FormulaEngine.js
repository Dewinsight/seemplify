function isWhitespace(char) {
  return /\s/.test(char);
}

function isDigit(char) {
  return /[0-9]/.test(char);
}

function isIdentifierStart(char) {
  return /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char) {
  return /[A-Za-z0-9_]/.test(char);
}

function tokenize(expression = '') {
  const input = String(expression || '');
  const tokens = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (isWhitespace(char)) {
      index += 1;
      continue;
    }

    const twoChar = input.slice(index, index + 2);
    if (['>=', '<=', '==', '!=', '&&', '||'].includes(twoChar)) {
      tokens.push({ type: 'operator', value: twoChar });
      index += 2;
      continue;
    }

    if ('+-*/%()!,.<>'.includes(char)) {
      const type = char === '(' || char === ')' ? 'paren' : (char === ',' ? 'comma' : 'operator');
      tokens.push({ type, value: char });
      index += 1;
      continue;
    }

    if (char === '"' || char === '\'') {
      const quote = char;
      index += 1;
      let value = '';
      while (index < input.length && input[index] !== quote) {
        if (input[index] === '\\' && index + 1 < input.length) {
          value += input[index + 1];
          index += 2;
          continue;
        }
        value += input[index];
        index += 1;
      }
      index += 1;
      tokens.push({ type: 'string', value });
      continue;
    }

    if (isDigit(char) || (char === '.' && isDigit(input[index + 1]))) {
      let value = char;
      index += 1;
      while (index < input.length && /[0-9.]/.test(input[index])) {
        value += input[index];
        index += 1;
      }
      tokens.push({ type: 'number', value });
      continue;
    }

    if (isIdentifierStart(char)) {
      let value = char;
      index += 1;
      while (index < input.length && isIdentifierPart(input[index])) {
        value += input[index];
        index += 1;
      }
      tokens.push({ type: 'identifier', value });
      continue;
    }

    throw new Error(`Unsupported token in formula at "${char}"`);
  }

  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
  }

  peek(offset = 0) {
    return this.tokens[this.index + offset] || null;
  }

  consume() {
    const token = this.peek();
    this.index += 1;
    return token;
  }

  expect(type, value = null) {
    const token = this.peek();
    if (!token || token.type !== type || (value !== null && token.value !== value)) {
      throw new Error(`Unexpected token in formula: expected ${type}${value ? ` ${value}` : ''}`);
    }
    return this.consume();
  }

  parse() {
    const expression = this.parseLogicalOr();
    if (this.peek()) {
      throw new Error(`Unexpected trailing token "${this.peek().value}"`);
    }
    return expression;
  }

  parseLogicalOr() {
    let left = this.parseLogicalAnd();
    while (this.peek()?.type === 'operator' && this.peek()?.value === '||') {
      const operator = this.consume().value;
      const right = this.parseLogicalAnd();
      left = { type: 'binary', operator, left, right };
    }
    return left;
  }

  parseLogicalAnd() {
    let left = this.parseEquality();
    while (this.peek()?.type === 'operator' && this.peek()?.value === '&&') {
      const operator = this.consume().value;
      const right = this.parseEquality();
      left = { type: 'binary', operator, left, right };
    }
    return left;
  }

  parseEquality() {
    let left = this.parseComparison();
    while (this.peek()?.type === 'operator' && ['==', '!='].includes(this.peek()?.value)) {
      const operator = this.consume().value;
      const right = this.parseComparison();
      left = { type: 'binary', operator, left, right };
    }
    return left;
  }

  parseComparison() {
    let left = this.parseAdditive();
    while (this.peek()?.type === 'operator' && ['>', '>=', '<', '<='].includes(this.peek()?.value)) {
      const operator = this.consume().value;
      const right = this.parseAdditive();
      left = { type: 'binary', operator, left, right };
    }
    return left;
  }

  parseAdditive() {
    let left = this.parseMultiplicative();
    while (this.peek()?.type === 'operator' && ['+', '-'].includes(this.peek()?.value)) {
      const operator = this.consume().value;
      const right = this.parseMultiplicative();
      left = { type: 'binary', operator, left, right };
    }
    return left;
  }

  parseMultiplicative() {
    let left = this.parseUnary();
    while (this.peek()?.type === 'operator' && ['*', '/', '%'].includes(this.peek()?.value)) {
      const operator = this.consume().value;
      const right = this.parseUnary();
      left = { type: 'binary', operator, left, right };
    }
    return left;
  }

  parseUnary() {
    if (this.peek()?.type === 'operator' && ['!', '-'].includes(this.peek()?.value)) {
      const operator = this.consume().value;
      return { type: 'unary', operator, argument: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const token = this.peek();
    if (!token) {
      throw new Error('Unexpected end of formula');
    }

    if (token.type === 'number') {
      this.consume();
      return { type: 'literal', value: Number(token.value) };
    }

    if (token.type === 'string') {
      this.consume();
      return { type: 'literal', value: token.value };
    }

    if (token.type === 'identifier') {
      return this.parseIdentifierOrCall();
    }

    if (token.type === 'paren' && token.value === '(') {
      this.consume();
      const expression = this.parseLogicalOr();
      this.expect('paren', ')');
      return expression;
    }

    throw new Error(`Unexpected token "${token.value}"`);
  }

  parseIdentifierOrCall() {
    const path = [this.expect('identifier').value];

    while (this.peek()?.type === 'operator' && this.peek()?.value === '.') {
      this.consume();
      path.push(this.expect('identifier').value);
    }

    if (this.peek()?.type === 'paren' && this.peek()?.value === '(') {
      this.consume();
      const args = [];
      while (!(this.peek()?.type === 'paren' && this.peek()?.value === ')')) {
        args.push(this.parseLogicalOr());
        if (this.peek()?.type === 'comma') {
          this.consume();
          continue;
        }
        break;
      }
      this.expect('paren', ')');
      return {
        type: 'call',
        callee: path.join('.'),
        arguments: args,
      };
    }

    return {
      type: 'identifier',
      path,
    };
  }
}

function resolvePath(context, path = []) {
  return path.reduce((current, key) => {
    if (current === null || current === undefined) return undefined;
    return current[key];
  }, context);
}

function truthy(value) {
  return !!value;
}

function evaluateNode(node, context, functions) {
  switch (node.type) {
    case 'literal':
      return node.value;
    case 'identifier':
      return resolvePath(context, node.path);
    case 'unary': {
      const value = evaluateNode(node.argument, context, functions);
      if (node.operator === '!') return !truthy(value);
      if (node.operator === '-') return -Number(value || 0);
      throw new Error(`Unsupported unary operator ${node.operator}`);
    }
    case 'binary': {
      const left = evaluateNode(node.left, context, functions);
      const right = evaluateNode(node.right, context, functions);
      switch (node.operator) {
        case '+': return Number(left || 0) + Number(right || 0);
        case '-': return Number(left || 0) - Number(right || 0);
        case '*': return Number(left || 0) * Number(right || 0);
        case '/': return Number(right || 0) === 0 ? 0 : Number(left || 0) / Number(right || 0);
        case '%': return Number(right || 0) === 0 ? 0 : Number(left || 0) % Number(right || 0);
        case '>': return left > right;
        case '>=': return left >= right;
        case '<': return left < right;
        case '<=': return left <= right;
        case '==': return left === right;
        case '!=': return left !== right;
        case '&&': return truthy(left) && truthy(right);
        case '||': return truthy(left) || truthy(right);
        default:
          throw new Error(`Unsupported operator ${node.operator}`);
      }
    }
    case 'call': {
      const fn = functions[node.callee];
      if (typeof fn !== 'function') {
        throw new Error(`Unsupported formula function "${node.callee}"`);
      }
      return fn(...node.arguments.map((argument) => evaluateNode(argument, context, functions)));
    }
    default:
      throw new Error(`Unsupported AST node "${node.type}"`);
  }
}

class FormulaEngine {
  constructor() {
    this.cache = new Map();
    this.functions = {
      min: (...args) => Math.min(...args.map((value) => Number(value || 0))),
      max: (...args) => Math.max(...args.map((value) => Number(value || 0))),
      abs: (value) => Math.abs(Number(value || 0)),
      floor: (value) => Math.floor(Number(value || 0)),
      ceil: (value) => Math.ceil(Number(value || 0)),
      round: (value, precision = 2) => {
        const numericValue = Number(value || 0);
        const factor = 10 ** Number(precision || 0);
        return Math.round((numericValue + Number.EPSILON) * factor) / factor;
      },
      if: (condition, truthyValue, falsyValue) => (condition ? truthyValue : falsyValue),
    };
  }

  compile(expression = '') {
    const normalized = String(expression || '').trim();
    if (!normalized) return null;
    if (this.cache.has(normalized)) {
      return this.cache.get(normalized);
    }

    const ast = new Parser(tokenize(normalized)).parse();
    this.cache.set(normalized, ast);
    return ast;
  }

  evaluate(expression = '', context = {}) {
    const ast = this.compile(expression);
    if (!ast) return undefined;
    return evaluateNode(ast, context, this.functions);
  }
}

module.exports = new FormulaEngine();
