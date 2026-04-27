function safeCalculate(expression) {
  const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, '');

  if (!/^[\d\s+\-*/().%]+$/.test(sanitized)) {
    throw new Error('无效的数学表达式');
  }

  try {
    const result = new Function(`'use strict'; return (${sanitized})`)();

    if (typeof result !== 'number' || !isFinite(result)) {
      throw new Error('计算结果无效');
    }

    return result;
  } catch (error) {
    throw new Error('计算失败，请检查表达式');
  }
}

export async function execute(params, context) {
  const expression = params.expression;

  if (!expression) {
    throw new Error('请提供数学表达式');
  }

  try {
    const result = safeCalculate(expression);
    return `${expression} = ${result}`;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '计算失败';
    return `计算错误: ${errorMsg}`;
  }
}
