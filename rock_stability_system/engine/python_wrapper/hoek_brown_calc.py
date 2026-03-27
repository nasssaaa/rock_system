import math
import numpy as np
from typing import Tuple, Dict

class RockFailureCriterion:
    """
    千米深层岩体力学稳定性判定计算模块。
    核心利用 Hoek-Brown 经验强度准则将岩体参数转换为等效莫尔-库伦 (Mohr-Coulomb) 内摩擦角和凝聚力。
    """
    
    def __init__(self, m_i: float = 15.0):
        """
        初始化岩石破坏准则计算。
        :param m_i: 完整岩块的材料常数 (不同岩性各异，硬岩如花岗岩可达 33，软岩如页岩约需 7，默认为 15)。
        """
        self.m_i = m_i

    def calculate_equivalent_mc_params(self, 
                                       sigma_ci: float, 
                                       GSI: float, 
                                       D: float = 0.0, 
                                       sigma_3max: float = None) -> Tuple[float, float, Dict]:
        """
        基于广义 Hoek-Brown 准则计算等效的黏聚力 c 和内摩擦角 φ。
        
        数学原理解析:
        1. 广义 Hoek-Brown 强度准则方程 (对于破裂围岩):
           sigma_1 = sigma_3 + sigma_ci * (m_b * (sigma_3 / sigma_ci) + s)^a
        2. 参数计算 (2002 版 GSI 换算推导):
           m_b = m_i * exp((GSI - 100) / (28 - 14 * D))
           s   = exp((GSI - 100) / (9 - 3 * D))
           a   = 0.5 + 1/6 * (exp(-GSI/15) - exp(-20/3))
        3. 转换等效 Mohr-Coulomb:
           由于深部岩体会承受较高的围压，需要一个应力上限 sigma_3max 以线性化拟合到 M-C 包络线。
           
        :param sigma_ci: 完整岩石单轴抗压强度 (MPa)
        :param GSI: 地质强度指标 (Geological Strength Index)，范围 0-100
        :param D: 岩体扰动系数，范围 0-1（无扰动为0，强爆破极大破坏为1）
        :param sigma_3max: 用于拟合的最大围压值 (MPa)。如果未提供，默认采用经验公式近似。
        :return: (c_eq [MPa], phi_eq [度], 详细的力学计算中间参数字典)
        """
        if GSI < 0 or GSI > 100:
            raise ValueError("GSI (地质强度指标) 必须在 0 到 100 之间")
        if D < 0.0 or D > 1.0:
            raise ValueError("D (扰动系数) 必须在 0.0 到 1.0 之间")
            
        # 计算 Hoek-Brown 变形特征参数
        m_b = self.m_i * math.exp((GSI - 100) / (28 - 14 * D))
        s_val = math.exp((GSI - 100) / (9 - 3 * D))
        a_val = 0.5 + (1.0/6.0) * (math.exp(-GSI/15.0) - math.exp(-20.0/3.0))
        
        # 岩体全局单轴抗压强度 (Uniaxial Compressive Strength of rock mass)
        sigma_c_mass = sigma_ci * (s_val ** a_val)
        
        # 岩体全局抗拉强度 (如果为零防除零错)
        sigma_t = -s_val * sigma_ci / m_b if m_b > 0 else 0.0
        
        # 若未指定考虑的工程最大围压范围，按标准地下工程开挖常数预估：
        if sigma_3max is None:
            gamma = 0.027  # 岩体容重估测 (MN/m^3)
            depth = 1000   # 默认为千米深井 (m)
            sigma_v = gamma * depth # 基础垂向主应力
            sigma_cm = sigma_ci * ((m_b + 4 * s_val - a_val * (m_b - 8 * s_val)) * (m_b / 4 + s_val)**(a_val - 1)) / (2 * (1 + a_val) * (2 + a_val))
            sigma_3max = 0.47 * sigma_cm * (sigma_cm / gamma / depth)**(-0.94)
            if sigma_3max <= 0:
                sigma_3max = 0.25 * sigma_ci # 兜底逻辑
                
        # 拟合系数计算等效 Mohr-Coulomb 黏聚力与内摩擦角
        # (遵循 Hoek, Carranza-Torres & Corkum (2002) 第 8 届 ISRM 岩石力学大会推荐解析解法)
        numerator_angle = 6 * a_val * m_b * (s_val + m_b * (sigma_3max / sigma_ci))**(a_val - 1)
        denominator_angle = 2 * (1 + a_val) * (2 + a_val) + 6 * a_val * m_b * (s_val + m_b * (sigma_3max / sigma_ci))**(a_val - 1)
        
        # 等效内摩擦角 phi (以弧度转角度返回)
        # 防止数值计算误差导致超出 [-1, 1] 范围
        sin_phi = min(1.0, max(-1.0, numerator_angle / denominator_angle))
        phi_rad = math.asin(sin_phi)
        phi_deg = math.degrees(phi_rad)
        
        # 等效凝聚力 c
        # 稳健计算方式，避免分母为 0 或因浮点数误差出现负数开根号
        c_numerator = sigma_ci * ((1 + 2 * a_val) * s_val + (1 - a_val) * m_b * (sigma_3max / sigma_ci)) * (s_val + m_b * (sigma_3max / sigma_ci))**(a_val - 1)
        cos_phi = math.cos(phi_rad)
        if cos_phi == 0:
            c_eq = 0.0
        else:
            c_eq = c_numerator / ((1 + a_val) * (2 + a_val) * math.sqrt(1 + sin_phi) / cos_phi)
        
        details = {
            "m_b": m_b,
            "s": s_val,
            "a": a_val,
            "sigma_c_mass_MPa": sigma_c_mass,
            "sigma_t_tensile_MPa": sigma_t,
            "sigma_3max_MPa": sigma_3max
        }
        
        return c_eq, phi_deg, details

    def assess_rockburst_risk(self, sigma_theta: float, sigma_c: float) -> Tuple[str, float]:
        """
        基于岩石孔壁切向应力 (Tangential Stress) 和 完整岩石单轴抗压强度 (UCS) 比值进行的岩爆倾向性评估。
        使用 Russenes 或传统的经验临界值法: R = sigma_theta / sigma_c
        
        :param sigma_theta: 开挖面附近的局部最大切向应力 (MPa) (例如通过前置的引擎应力场算法算出)
        :param sigma_c: 岩块或者岩体的单轴抗压强度 (MPa)
        :return: (岩爆危险等级字符串, R 比值)
        """
        r_ratio = sigma_theta / sigma_c
        
        # 经验区间划分：
        # R < 0.2 : 基本无岩爆危险
        # 0.2 <= R < 0.3 : 弱岩爆
        # 0.3 <= R < 0.5 : 中等岩爆
        # R >= 0.5 : 强岩爆 (脆性破坏极易发生)
        
        if r_ratio < 0.2:
            level = "无危险 (Safe)"
        elif 0.2 <= r_ratio < 0.3:
            level = "轻微/弱岩爆 (Slight)"
        elif 0.3 <= r_ratio < 0.5:
            level = "中等岩爆 (Moderate)"
        else:
            level = "强烈岩爆 (Severe/Strong)"
            
        return level, r_ratio


if __name__ == "__main__":
    # --- 模块测试 ---
    print("--- Hoek-Brown 强度准则等效转换计算 ---")
    hb_calc = RockFailureCriterion(m_i=15.0) # 假设某种中坚硬沉积岩
    
    # 比如在深地隧道，单轴抗压 80 MPa，岩体结构相对完好 GSI=75，机械开挖无严重爆破破坏 D=0
    c_eq, phi_deg, details = hb_calc.calculate_equivalent_mc_params(sigma_ci=80.0, GSI=75.0, D=0.0)
    
    print(f"等效黏聚力 c: {c_eq:.2f} MPa")
    print(f"等效内摩擦角 φ: {phi_deg:.2f} 度")
    print(f"岩体整体抗压强度: {details['sigma_c_mass_MPa']:.2f} MPa")
    print(f"岩体整体抗拉强度: {details['sigma_t_tensile_MPa']:.2f} MPa\n")
    
    print("--- 岩爆倾向性判别计算 ---")
    # 假设某掌子面围岩经过三维形变导致局部集中切向应力达到 35 MPa
    tangential_stress = 35.0
    ucs_strength = 80.0
    level, ratio = hb_calc.assess_rockburst_risk(tangential_stress, ucs_strength)
    print(f"局部切向应力 σθ = {tangential_stress} MPa, 岩石强度 σc = {ucs_strength} MPa")
    print(f"岩爆风险比值 (σθ/σc) = {ratio:.3f}")
    print(f"危险等级评估 = {level}")
