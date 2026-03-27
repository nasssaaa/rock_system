import math
from typing import List, Tuple
import numpy as np

class BValueCalculator:
    """
    基于古登堡-里克特法则 (Gutenberg-Richter Law) 的 b 值演化计算引擎。
    b值是衡量微震事件能量分布特征的重要指标。b值下降通常意味着大能量破裂占比增加，是冲击地压/岩爆的强前兆。
    """
    
    def __init__(self, history_capacity: int = 5):
        """
        :param history_capacity: 要跟踪评估“持续下降”趋势的历史 b 值窗口大小
        """
        self.b_value_history = []
        self.history_capacity = history_capacity

    def estimate_b_value(self, energies: List[float], mc_percentile: float = 10.0) -> float:
        """
        使用最大似然估计法 (MLE) 或者稳健回归计计算某一时段内事件阵列的 b 值。
        
        :param energies: 一组微震事件的释放能量 (J 或相对单位)
        :param mc_percentile: 完整性震级 Mc 选取的百分位数（过滤极小底噪）
        :return: b 值 (float)
        """
        if not energies or len(energies) < 3:
            return float('nan')
            
        # 1. 能量转等效震级 (M)
        # 这里使用简化的相对换算公式 M ~ log10(E) (对于评估相对斜率而言截距不重要)
        magnitudes = np.log10(np.array(energies) + 1e-6) # 避免 log10(0)
        
        # 2. 确定完备震级 Mc (Magnitude of Completeness)
        # 用百分位数剔除一部分可能的由于传感器限制未完全捕捉的小破裂
        mc = np.percentile(magnitudes, mc_percentile)
        
        # 过滤出大于等于完备震级的有效事件
        valid_mags = magnitudes[magnitudes >= mc]
        
        if len(valid_mags) < 3:
            return float('nan')
            
        # 3. Aki-Utsu 最大似然估计 (MLE) 计算 b 值
        # 公式: b = log10(e) / (M_mean - Mc)
        m_mean = np.mean(valid_mags)
        
        # 防止分母极小导致除零甚至 b 飙升
        # 如果大家震级都差不多 (集中在很窄的分布)，b 理论上极大，这里设个安全阈值
        if m_mean - mc < 1e-4:
            return float('nan')
            
        b_value = math.log10(math.e) / (m_mean - mc)
        
        return float(b_value)

    def assess_risk_using_b_value(self, current_energies: List[float], alert_threshold: float = 0.8) -> Tuple[bool, float, str]:
        """
        输入最新一盘时间窗口的能量序列，计算 b 值，与历史对比，如果发生“持续下降趋势”则发起预警。
        
        :param current_energies: 当前滑动时间窗内的事件能量列表
        :param alert_threshold: 触发岩爆红色预警的b值下限
        :return: (是否触发岩爆预警[bool], 最新的b值[float], 预警/状态描述信息[str])
        """
        print(f"当前使用的b值预警阈值为: {alert_threshold}")
        current_b = self.estimate_b_value(current_energies)
        
        if math.isnan(current_b):
            return False, current_b, "样本不足或能量分布无有效梯度，无法计算 b 值"
            
        # 存入历史队列
        self.b_value_history.append(current_b)
        if len(self.b_value_history) > self.history_capacity:
            self.b_value_history.pop(0)
            
        # 趋势评估逻辑
        warning_triggered = False
        message = f"当前 b 值正常摆动: {current_b:.3f}"
        
        is_dropping = False
        # 如果攒够了至少 3 次以上的计算记录，就检查是否出现阶梯连续下降
        if len(self.b_value_history) >= 3:
            # 检查最近 N 次是不是一直下降
            history = self.b_value_history
            # 判断严格单调递减
            is_dropping = all(x > y for x, y in zip(history, history[1:]))
            
            # 或者当前 b 值绝对值低于高危临界警戒线
            is_critical_low = current_b < alert_threshold
            
            if is_dropping and is_critical_low:
                warning_triggered = True
                message = f"【红色岩爆预警】b 值连续 {len(history)} 期下降并突破极危下限值 {alert_threshold}！(当前 b={current_b:.3f})"
            elif is_dropping:
                warning_triggered = True
                message = f"【黄色预警】b 值出现异动连续下降！大能量破裂比例持续攀升 (当前 b={current_b:.3f})"
            elif is_critical_low:
                warning_triggered = True
                message = f"【红色岩爆预警】b 值处于极低危险水位点！高能强震活动剧烈 (当前 b={current_b:.3f})"
                
        return warning_triggered, current_b, message

if __name__ == "__main__":
    # --- 模块单元测试 ---
    print("--- Gutenberg-Richter b-value 演化计算与岩爆预警 ---")
    calculator = BValueCalculator(history_capacity=4)
    
    # 模拟事件序列 1: 大量低能破裂，极少高能 (代表围岩初期安全松动)
    energies_t1 = [15.0]*100 + [50.0]*50 + [100.0]*10 + [500.0]*2
    print(calculator.assess_risk_using_b_value(energies_t1))
    
    # 模拟事件序列 2: 能量向中高转移
    energies_t2 = [15.0]*80 + [50.0]*60 + [200.0]*20 + [1500.0]*5
    print(calculator.assess_risk_using_b_value(energies_t2))
    
    # 模拟事件序列 3: 更明显的大能量群
    energies_t3 = [20.0]*50 + [100.0]*50 + [500.0]*30 + [4000.0]*10
    print(calculator.assess_risk_using_b_value(energies_t3))
    
    # 模拟事件序列 4: 即将爆发，微震点减少但是全是大破裂
    energies_t4 = [100.0]*10 + [800.0]*40 + [8000.0]*20
    print(calculator.assess_risk_using_b_value(energies_t4))
