import { createRepository } from '../../src/repository.js';
import { seed } from './seed.js';
export const testRepository = (options = {}) => createRepository({ ...options, initial: seed(), cleanDemo: false });
