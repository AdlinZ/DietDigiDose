import { describe, expect, it } from 'vitest';
import { parseRecipeArray, qualityIssueText, recipeStatusText } from './recipeReviewModel';

describe('recipe review database formats', () => {
  it.each([
    ['nutrition_unknown', 'cooking_not_reviewed'],
    JSON.stringify(['nutrition_unknown', 'cooking_not_reviewed']),
  ])('shows actionable import issues for %j', (value) => {
    expect(qualityIssueText({ quality_issues_json: value })).toBe('营养数据尚未核验；烹饪内容尚未审核');
  });

  it('preserves steps and ingredients when opening PostgreSQL or SQLite records', () => {
    const steps = ['切好食材', '翻炒均匀'];
    const ingredients = [{ name: '番茄', amount: '2个' }];
    for (const value of [steps, ingredients]) {
      expect(parseRecipeArray<unknown>(value)).toEqual(value);
      expect(parseRecipeArray(JSON.stringify(value))).toEqual(value);
    }
  });

  it('keeps malformed records visible as errors and preserves unknown issue codes', () => {
    for (const value of ['{', '{}', '[null]']) {
      expect(qualityIssueText({ quality_issues_json: value })).toBe('质量问题记录无法解析');
    }
    expect(qualityIssueText({ quality_issues_json: ['future_issue'] })).toBe('future_issue');
    expect(qualityIssueText({ quality_issues_json: null })).toBe('');
  });

  it('uses actual status for imported recipes too', () => {
    expect(recipeStatusText('pending')).toBe('待审核');
    expect(recipeStatusText('approved')).toBe('已通过');
    expect(recipeStatusText('rejected')).toBe('已驳回');
    expect(recipeStatusText()).toBe('状态未知');
  });
});
