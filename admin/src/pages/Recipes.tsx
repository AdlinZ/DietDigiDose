import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  Minus,
  Pencil,
  Plus,
  Search,
  Trash2,
  UtensilsCrossed,
  X,
  FileText,
  Sparkles,
  Clock,
} from 'lucide-react';
import api from '../services/api';
import { cn } from '../utils/cn';

type Recipe = {
  id: number;
  title: string;
  category: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  cook_time?: string | number;
  difficulty?: string;
  image_url: string;
  description?: string;
  tags?: string;
  steps_json?: string;
  ingredients_json?: string;
  source?: string;
  status?: 'pending' | 'approved' | 'rejected';
  author_username?: string;
  reject_reason?: string;
  quality_status?: 'trusted' | 'estimated' | 'needs_review';
  nutrition_basis?: 'source' | 'ingredient_estimate' | 'category_fallback';
  quality_issues_json?: string;
  quality_review_reason?: string;
};

type Ingredient = {
  name: string;
  amount: string;
};

type RecipeFormState = {
  title: string;
  category: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  cook_time: string;
  difficulty: string;
  image_url: string;
  description: string;
  steps: string[];
  ingredients: Ingredient[];
};

const CATEGORIES = ['全部', '减脂', '增肌', '营养餐单', '快手菜'];
const DIFFICULTIES = ['简单', '中等', '较难'];
const QUALITY_ISSUE_LABELS: Record<string, string> = {
  category_nutrition_fallback: '使用分类固定营养兜底',
  implausible_cook_time: '烹饪时间明显不合理',
  instruction_as_ingredient: '步骤被误识别为食材',
  truncated_ingredient: '食材文本疑似截断',
  insufficient_structure: '食材或步骤结构不完整',
};

function qualityIssueText(recipe: Recipe) {
  try {
    const issues = JSON.parse(recipe.quality_issues_json || '[]');
    return Array.isArray(issues) ? issues.map((issue) => QUALITY_ISSUE_LABELS[String(issue)] || String(issue)).join('；') : '';
  } catch {
    return '质量问题记录无法解析';
  }
}

const INITIAL_FORM_STATE: RecipeFormState = {
  title: '',
  category: '减脂餐',
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
  cook_time: '15分钟',
  difficulty: '简单',
  image_url: '',
  description: '',
  steps: [''],
  ingredients: [{ name: '', amount: '' }],
};

export default function Recipes() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('全部');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'official' | 'user'>('all');
  const [reviewStatus, setReviewStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [qualityStatus, setQualityStatus] = useState<'all' | 'trusted' | 'estimated' | 'needs_review'>('all');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalRecipes, setTotalRecipes] = useState(0);
  const [summary, setSummary] = useState({ platform: 0, user: 0, pending: 0, needsReview: 0 });

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<RecipeFormState>(INITIAL_FORM_STATE);

  const fetchRecipes = useCallback(async (cursor?: string) => {
    try {
      setLoading(true);
      const { data } = await api.get('/admin/recipes', {
        params: {
          source: sourceFilter === 'all' ? undefined : sourceFilter,
          reviewStatus: reviewStatus === 'all' ? undefined : reviewStatus,
          qualityStatus: qualityStatus === 'all' ? undefined : qualityStatus,
          category: activeCategory === '全部' ? undefined : activeCategory,
          search: searchQuery.trim() || undefined,
          pageSize: 50,
          cursor,
        },
      });
      setRecipes(current => cursor ? [...current, ...data.items.filter((item: Recipe) => !current.some(existing => existing.id === item.id))] : data.items);
      setNextCursor(data.nextCursor);
      setTotalRecipes(Number(data.total || data.items.length));
      setSummary({
        platform: Number(data.summary?.platform || 0),
        user: Number(data.summary?.user || 0),
        pending: Number(data.summary?.pending || 0),
        needsReview: Number(data.summary?.needs_review || 0),
      });
    } catch (error) {
      console.error('Error fetching recipes:', error);
    } finally {
      setLoading(false);
    }
  }, [activeCategory, qualityStatus, reviewStatus, searchQuery, sourceFilter]);

  useEffect(() => {
    fetchRecipes();
  }, [fetchRecipes]);

  const handleDelete = async (id: number) => {
    if (!window.confirm('确定要将这个食谱移入回收站吗？之后可在“安全审计”中恢复。')) return;
    try {
      await api.delete(`/admin/recipes/${id}`);
      fetchRecipes();
    } catch {
      alert('删除失败');
    }
  };

  const handleApprove = async (id: number) => {
    try {
      await api.post(`/admin/recipes/${id}/approve`);
      await fetchRecipes();
    } catch (error: any) {
      alert(error.response?.data?.error || '审核失败');
    }
  };

  const handleReject = async (id: number) => {
    const reason = window.prompt('请输入驳回原因，用户修改后可重新提交：');
    if (!reason) return;
    try {
      await api.post(`/admin/recipes/${id}/reject`, { reason });
      await fetchRecipes();
    } catch (error: any) {
      alert(error.response?.data?.error || '驳回失败');
    }
  };

  const handleQualityReview = async (recipe: Recipe, status: 'trusted' | 'needs_review') => {
    const reason = window.prompt(
      status === 'trusted'
        ? '请输入设为可信的依据（例如：已逐项核对原始来源与营养数据）：'
        : '请输入待复核原因（该菜谱会立即退出公开列表和推荐）：',
      recipe.quality_review_reason || '',
    );
    if (!reason) return;
    try {
      await api.put(`/admin/recipes/${recipe.id}/quality`, { status, reason });
      await fetchRecipes();
    } catch (error: any) {
      alert(error.response?.data?.error || '质量审核失败');
    }
  };

  const handleOpenAdd = () => {
    setEditingId(null);
    setFormData(INITIAL_FORM_STATE);
    setShowModal(true);
  };

  const handleOpenEdit = (recipe: Recipe) => {
    setEditingId(recipe.id);
    
    let parsedSteps = [''];
    try {
      if (recipe.steps_json) {
        const parsed = JSON.parse(recipe.steps_json);
        if (Array.isArray(parsed) && parsed.length > 0) parsedSteps = parsed;
      }
    } catch {}

    let parsedIngredients = [{ name: '', amount: '' }];
    try {
      if (recipe.ingredients_json) {
        const parsed = JSON.parse(recipe.ingredients_json);
        if (Array.isArray(parsed) && parsed.length > 0) parsedIngredients = parsed;
      }
    } catch {}

    setFormData({
      title: recipe.title || '',
      category: recipe.category || '减脂餐',
      calories: recipe.calories ? String(recipe.calories) : '',
      protein: recipe.protein ? String(recipe.protein) : '',
      carbs: recipe.carbs ? String(recipe.carbs) : '',
      fat: recipe.fat ? String(recipe.fat) : '',
      cook_time: recipe.cook_time ? String(recipe.cook_time) : '15分钟',
      difficulty: recipe.difficulty || '简单',
      image_url: recipe.image_url || '',
      description: recipe.description || '',
      steps: parsedSteps,
      ingredients: parsedIngredients,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) {
      alert('请输入食谱名称');
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        title: formData.title.trim(),
        category: formData.category,
        calories: Number(formData.calories) || 0,
        protein: Number(formData.protein) || 0,
        carbs: Number(formData.carbs) || 0,
        fat: Number(formData.fat) || 0,
        cook_time: formData.cook_time,
        difficulty: formData.difficulty,
        image_url: formData.image_url.trim(),
        description: formData.description.trim(),
        steps_json: JSON.stringify(formData.steps.filter((s) => s.trim())),
        ingredients_json: JSON.stringify(
          formData.ingredients.filter((i) => i.name.trim() || i.amount.trim())
        ),
      };

      if (editingId) {
        await api.put(`/admin/recipes/${editingId}`, payload);
      } else {
        await api.post('/admin/recipes', payload);
      }

      setShowModal(false);
      fetchRecipes();
    } catch (err: any) {
      alert('保存失败: ' + (err.response?.data?.error || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  const filteredRecipes = recipes;

  const updateStep = (index: number, val: string) => {
    const newSteps = [...formData.steps];
    newSteps[index] = val;
    setFormData({ ...formData, steps: newSteps });
  };
  const addStep = () => setFormData({ ...formData, steps: [...formData.steps, ''] });
  const removeStep = (index: number) => {
    setFormData({ ...formData, steps: formData.steps.filter((_, i) => i !== index) });
  };

  const updateIngredient = (index: number, field: keyof Ingredient, val: string) => {
    const newIngs = [...formData.ingredients];
    newIngs[index] = { ...newIngs[index], [field]: val };
    setFormData({ ...formData, ingredients: newIngs });
  };
  const addIngredient = () =>
    setFormData({ ...formData, ingredients: [...formData.ingredients, { name: '', amount: '' }] });
  const removeIngredient = (index: number) => {
    setFormData({ ...formData, ingredients: formData.ingredients.filter((_, i) => i !== index) });
  };

  const recipeStats = useMemo(() => {
    return { total: totalRecipes, platform: summary.platform, userContributed: summary.user, pending: summary.pending, needsReview: summary.needsReview };
  }, [summary, totalRecipes]);

  if (loading) return <div className="text-center py-20 text-text-muted">加载中...</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-text-main flex items-center gap-2">
            <UtensilsCrossed className="w-7 h-7 text-secondary" />
            食谱库管理
          </h2>
          <p className="text-xs text-text-muted mt-1">发布与维护官方精品减脂/健康食谱，并审核社区用户投稿</p>
        </div>
        <button
          type="button"
          onClick={handleOpenAdd}
          className="bg-primary text-white px-4 py-2.5 rounded-2xl flex items-center space-x-2 hover:bg-primary/90 transition-colors shadow-sm text-xs font-medium self-start sm:self-auto"
        >
          <Plus size={16} />
          <span>发布官方食谱</span>
        </button>
      </div>

      {/* Top Metric Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center justify-between rounded-[24px] bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-medium text-text-muted">当前筛选食谱</p>
            <p className="mt-1.5 text-2xl font-bold text-text-main">{recipeStats.total}</p>
          </div>
          <div className="rounded-2xl bg-secondary/10 p-3 text-secondary">
            <UtensilsCrossed className="h-6 w-6" />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-[24px] bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-medium text-text-muted">平台食谱（含导入）</p>
            <p className="mt-1.5 text-2xl font-bold text-primary">{recipeStats.platform}</p>
          </div>
          <div className="rounded-2xl bg-primary/10 p-3 text-primary">
            <Sparkles className="h-6 w-6" />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-[24px] bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-medium text-text-muted">社区用户投稿</p>
            <p className="mt-1.5 text-2xl font-bold text-blue-600">{recipeStats.userContributed}</p>
          </div>
          <div className="rounded-2xl bg-blue-50 p-3 text-blue-600">
            <FileText className="h-6 w-6" />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-[24px] bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-medium text-text-muted">待审核投稿</p>
            <p className="mt-1.5 text-2xl font-bold text-orange-600">{recipeStats.pending}</p>
          </div>
          <div className="rounded-2xl bg-orange-50 p-3 text-orange-600">
            <Clock className="h-6 w-6" />
          </div>
        </div>
      </div>

      {/* Category Tabs & Search */}
      <div className="bg-white p-4 rounded-3xl shadow-sm space-y-4 border border-gray-100">
        <div className="flex flex-wrap items-center gap-2 border-b border-background-alt pb-4">
          {[
            { value: 'all', label: '全部来源' },
            { value: 'official', label: '平台食谱（含导入）' },
            { value: 'user', label: '用户投稿' },
          ].map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setSourceFilter(item.value as typeof sourceFilter)}
              className={cn(
                'rounded-xl px-4 py-2 text-sm font-medium',
                sourceFilter === item.value ? 'bg-primary text-white' : 'bg-background-alt text-text-muted',
              )}
            >
              {item.label}
            </button>
          ))}
          <span className="mx-1 h-6 w-px bg-background-alt" />
          {[
            { value: 'all', label: '全部质量' },
            { value: 'trusted', label: '可信' },
            { value: 'estimated', label: '营养估算' },
            { value: 'needs_review', label: `待复核${recipeStats.needsReview ? ` ${recipeStats.needsReview}` : ''}` },
          ].map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setQualityStatus(item.value as typeof qualityStatus)}
              className={cn(
                'rounded-xl px-3 py-2 text-xs font-medium',
                qualityStatus === item.value
                  ? 'bg-amber-100 text-amber-800'
                  : 'text-text-muted hover:bg-background-alt',
              )}
            >
              {item.label}
            </button>
          ))}
          <span className="mx-1 h-6 w-px bg-background-alt" />
          {[
            { value: 'all', label: '全部状态' },
            { value: 'pending', label: '待审核' },
            { value: 'approved', label: '已通过' },
            { value: 'rejected', label: '已驳回' },
          ].map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setReviewStatus(item.value as typeof reviewStatus)}
              className={cn(
                'rounded-xl px-3 py-2 text-xs font-medium',
                reviewStatus === item.value
                  ? 'bg-secondary/15 text-secondary'
                  : 'text-text-muted hover:bg-background-alt',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={cn(
                "px-4 py-2 rounded-xl text-sm font-medium transition-colors",
                activeCategory === cat
                  ? "bg-primary text-white"
                  : "bg-background-alt text-text-muted hover:bg-gray-200"
              )}
            >
              {cat}
            </button>
          ))}
        </div>
        <div className="flex items-center space-x-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="搜索食谱名称..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-50 border-none rounded-xl focus:ring-2 focus:ring-primary/20 text-sm"
            />
          </div>
          <div className="text-xs text-text-muted">共 {filteredRecipes.length} 款食谱</div>
        </div>
      </div>

      {filteredRecipes.length === 0 ? (
        <div className="bg-white rounded-[24px] p-12 text-center text-text-muted border border-gray-100">
          未搜索到相关食谱
        </div>
      ) : (
        <div className="overflow-hidden rounded-[24px] border border-gray-100 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1240px] text-left">
              <thead className="border-b border-background-alt bg-[#FAFBFA] text-xs text-text-muted">
                <tr><th className="px-5 py-4 font-medium">食谱</th><th className="px-4 py-4 font-medium">来源 / 作者</th><th className="px-4 py-4 font-medium">分类 / 难度</th><th className="px-4 py-4 font-medium">烹饪 / 热量</th><th className="px-4 py-4 font-medium">三大营养素</th><th className="px-4 py-4 font-medium">内容审核</th><th className="px-4 py-4 font-medium">质量状态</th><th className="px-5 py-4 text-right font-medium">操作</th></tr>
              </thead>
              <tbody className="divide-y divide-background-alt">
                {filteredRecipes.map((recipe) => <tr key={recipe.id} className="hover:bg-[#FCFDFB]">
                  <td className="px-5 py-3"><div className="flex items-center gap-3"><img src={recipe.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c'} alt="" className="h-12 w-12 rounded-xl object-cover" /><div className="max-w-56"><div className="truncate text-sm font-semibold text-text-main">{recipe.title}</div><div className="mt-1 line-clamp-1 text-xs text-text-muted">{recipe.description || '暂无简介'}</div></div></div></td>
                  <td className="px-4 py-3"><div className={cn('inline-flex rounded-full px-2 py-1 text-xs font-medium', recipe.source === 'user' ? 'bg-blue-50 text-blue-600' : 'bg-background-alt text-text-muted')}>{recipe.source === 'user' ? '用户投稿' : recipe.source === 'official' ? '官方自建' : '平台导入'}</div><div className="mt-1 text-xs text-text-muted">{recipe.source === 'user' ? recipe.author_username || '未知用户' : recipe.source === 'official' ? '食光编辑部' : recipe.source || '平台资料库'}</div></td>
                  <td className="px-4 py-3"><div className="text-sm text-text-main">{recipe.category || '综合推荐'}</div><div className="mt-1 text-xs text-text-muted">{recipe.difficulty || '简单'}</div></td>
                  <td className="px-4 py-3"><div className="text-sm font-medium text-text-main">{typeof recipe.cook_time === 'number' ? `${recipe.cook_time} 分钟` : recipe.cook_time || '-'} </div><div className="mt-1 text-xs text-text-muted">{recipe.calories ?? 0} kcal</div></td>
                  <td className="px-4 py-3 text-xs text-text-muted"><span>碳 {recipe.carbs ?? 0}g</span><span className="mx-2">蛋 {recipe.protein ?? 0}g</span><span>脂 {recipe.fat ?? 0}g</span></td>
                  <td className="px-4 py-3">{recipe.source === 'user' ? <span className={cn('inline-flex rounded-full px-2.5 py-1 text-xs font-medium', recipe.status === 'pending' && 'bg-amber-50 text-amber-700', recipe.status === 'approved' && 'bg-emerald-50 text-emerald-700', recipe.status === 'rejected' && 'bg-red-50 text-red-700')}>{recipe.status === 'pending' ? '待审核' : recipe.status === 'approved' ? '已通过' : '已驳回'}</span> : <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">已发布</span>}</td>
                  <td className="px-4 py-3"><div className={cn('inline-flex rounded-full px-2.5 py-1 text-xs font-medium', recipe.quality_status === 'needs_review' ? 'bg-red-50 text-red-700' : recipe.quality_status === 'estimated' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700')}>{recipe.quality_status === 'needs_review' ? '待复核' : recipe.quality_status === 'estimated' ? '营养估算' : '可信'}</div>{qualityIssueText(recipe) ? <div className="mt-1 max-w-44 truncate text-xs text-red-600" title={qualityIssueText(recipe)}>问题：{qualityIssueText(recipe)}</div> : null}</td>
                  <td className="px-5 py-3"><div className="flex items-center justify-end gap-2">{recipe.source === 'user' && recipe.status === 'pending' && <><button onClick={() => handleApprove(recipe.id)} className="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-white">通过</button><button onClick={() => handleReject(recipe.id)} className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-600">驳回</button></>}<button onClick={() => handleQualityReview(recipe, recipe.quality_status === 'needs_review' ? 'trusted' : 'needs_review')} className={cn('rounded-lg px-2.5 py-1.5 text-xs font-medium', recipe.quality_status === 'needs_review' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>{recipe.quality_status === 'needs_review' ? '设为可信' : '待复核'}</button><button onClick={() => handleOpenEdit(recipe)} className="rounded-lg p-2 text-text-muted hover:bg-primary/10 hover:text-primary" title="编辑"><Pencil size={15} /></button><button onClick={() => handleDelete(recipe.id)} className="rounded-lg p-2 text-text-muted hover:bg-red-50 hover:text-red-500" title="删除"><Trash2 size={15} /></button></div></td>
                </tr>)}
              </tbody>
            </table>
          </div>
          {nextCursor ? <div className="border-t border-background-alt p-4 text-center"><button type="button" onClick={() => void fetchRecipes(nextCursor)} disabled={loading} className="rounded-xl border border-background-alt px-4 py-2 text-xs font-semibold text-primary disabled:opacity-50">加载更多食谱</button></div> : null}
        </div>
      )}

      {/* Add/Edit Recipe Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-3xl shadow-xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-4 border-b border-gray-100 pb-3">
              <h3 className="text-lg font-bold text-text-main">
                {editingId ? '编辑食谱' : '发布新食谱'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-text-main p-1"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* 基本信息 */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold text-primary flex items-center gap-2">
                  <UtensilsCrossed size={16} /> 基本信息
                </h4>
                <div>
                  <label className="block text-xs font-bold text-text-main mb-1">食谱标题 *</label>
                  <input
                    type="text"
                    required
                    placeholder="例如：低脂蒜香香煎鸡胸肉"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-text-main mb-1">食谱分类</label>
                    <select
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                    >
                      {CATEGORIES.filter(c => c !== '全部').map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-text-main mb-1">烹饪难度</label>
                    <select
                      value={formData.difficulty}
                      onChange={(e) => setFormData({ ...formData, difficulty: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                    >
                      {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-text-main mb-1">预计烹饪时长</label>
                    <input
                      type="text"
                      placeholder="例如：20分钟"
                      value={formData.cook_time}
                      onChange={(e) => setFormData({ ...formData, cook_time: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-text-main mb-1">封面图片 URL</label>
                    <input
                      type="url"
                      placeholder="https://images.unsplash.com/..."
                      value={formData.image_url}
                      onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-main mb-1">食谱简介</label>
                  <textarea
                    rows={2}
                    placeholder="简单描述此食谱的亮点..."
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                  />
                </div>
              </div>

              {/* 营养信息 */}
              <div className="space-y-4 pt-4 border-t border-gray-100">
                <h4 className="text-sm font-bold text-secondary">营养信息 (每份)</h4>
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-text-main mb-1">热量 (kcal)</label>
                    <input
                      type="number"
                      placeholder="350"
                      value={formData.calories}
                      onChange={(e) => setFormData({ ...formData, calories: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-text-main mb-1">碳水 (g)</label>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="10"
                      value={formData.carbs}
                      onChange={(e) => setFormData({ ...formData, carbs: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-text-main mb-1">蛋白质 (g)</label>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="40"
                      value={formData.protein}
                      onChange={(e) => setFormData({ ...formData, protein: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-text-main mb-1">脂肪 (g)</label>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="8"
                      value={formData.fat}
                      onChange={(e) => setFormData({ ...formData, fat: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* 食材清单 */}
              <div className="space-y-4 pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-text-main">食材清单</h4>
                  <button
                    type="button"
                    onClick={addIngredient}
                    className="text-primary text-xs font-medium flex items-center gap-1 hover:underline"
                  >
                    <Plus size={14} /> 添加食材
                  </button>
                </div>
                <div className="space-y-2">
                  {formData.ingredients.map((ing, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <input
                        type="text"
                        placeholder="食材名称 (如: 鸡胸肉)"
                        value={ing.name}
                        onChange={(e) => updateIngredient(idx, 'name', e.target.value)}
                        className="flex-1 px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                      />
                      <input
                        type="text"
                        placeholder="用量 (如: 200g)"
                        value={ing.amount}
                        onChange={(e) => updateIngredient(idx, 'amount', e.target.value)}
                        className="flex-1 px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => removeIngredient(idx)}
                        className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                        disabled={formData.ingredients.length === 1}
                      >
                        <Minus size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* 烹饪步骤 */}
              <div className="space-y-4 pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-text-main">烹饪步骤</h4>
                  <button
                    type="button"
                    onClick={addStep}
                    className="text-primary text-xs font-medium flex items-center gap-1 hover:underline"
                  >
                    <Plus size={14} /> 添加步骤
                  </button>
                </div>
                <div className="space-y-3">
                  {formData.steps.map((step, idx) => (
                    <div key={idx} className="flex gap-3 items-start">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold mt-1">
                        {idx + 1}
                      </div>
                      <textarea
                        rows={2}
                        placeholder="描述该步骤的具体操作..."
                        value={step}
                        onChange={(e) => updateStep(idx, e.target.value)}
                        className="flex-1 px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => removeStep(idx)}
                        className="p-2 text-gray-400 hover:text-red-500 transition-colors mt-1"
                        disabled={formData.steps.length === 1}
                      >
                        <Minus size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-6 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-xl text-text-muted hover:bg-gray-100 text-sm font-medium transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-primary text-white hover:bg-primary/90 text-sm font-medium disabled:opacity-50 transition-colors"
                >
                  {submitting ? '保存中...' : (editingId ? '保存修改' : '确认发布')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
