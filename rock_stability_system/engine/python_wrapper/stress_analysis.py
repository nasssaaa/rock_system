import numpy as np
from typing import Tuple, Dict

class InSituStressAnalyzer:
    """
    千米深地围岩初始地应力场分析及坐标系转换模块。
    用于计算未开挖前深部原岩的应力状态，并转换到隧道局部极坐标系中。
    """

    def __init__(self, depth: float, gamma: float = 0.027):
        """
        初始化地应力分析器。
        
        :param depth: 目标分析的垂直深度 H (单位: m) (千米深井通常 1000m+)
        :param gamma: 上覆岩层平均重度 γ (单位: MN/m^3)。大多数岩石为 0.025 ~ 0.028 MN/m^3)
        """
        if depth <= 0:
            raise ValueError("深度必须大于 0")
        
        self.depth = depth
        self.gamma = gamma

    def init_in_situ_stress(self, k_h: float, k_H: float, alpha: float = 0.0) -> Dict[str, np.ndarray]:
        """
        根据深度和侧压力系数生成地应力张量（全局大地坐标系）。
        约定：
        z 轴为垂直向下方向（自重方向）。
        x, y 轴为水平面方向。这里我们假设 H_max 侧重在某一个特定方向上，
        通过 alpha (最大水平主应力方位角) 来转换到标准地理坐标 [North, East, Down] 或项目全局坐标。
        
        为简化起见，我们定义：
        - sigma_v: 垂直主应力 (主应力之一)
        - sigma_H: 最大水平主应力
        - sigma_h: 最小水平主应力
        
        :param k_h: 最小水平侧压力系数 (sigma_h / sigma_v)
        :param k_H: 最大水平侧压力系数 (sigma_H / sigma_v)
        :param alpha: 最大水平主应力与正北或项目 X 轴的夹角 (度，逆时针方向)，用于将主应力转换到参考坐标系。
        :return: 包含主应力分量及 3D 应力张量矩阵的字典。
        """
        # 1. 计算自重引起的垂直应力 σ_v (MPa)
        sigma_v = self.gamma * self.depth
        
        # 2. 考虑构造应力，计算大小水平主应力
        sigma_h = k_h * sigma_v
        sigma_H = k_H * sigma_v
        
        # 3. 建立主应力张量 S_principal (基于主应力方向建立的局部对角阵)
        # [ σ_H,   0,   0 ]
        # [   0, σ_h,   0 ]
        # [   0,   0, σ_v ]
        S_principal = np.array([
            [sigma_H, 0.0, 0.0],
            [0.0, sigma_h, 0.0],
            [0.0, 0.0, sigma_v]
        ])
        
        # 4. 坐标系旋转：如果最大水平主应力不平行于全局坐标 X 轴，而是存在一个偏角 alpha
        alpha_rad = np.radians(alpha)
        
        # 旋转矩阵 R (仅在水平面内旋转，绕 Z 轴)
        cos_a = np.cos(alpha_rad)
        sin_a = np.sin(alpha_rad)
        R = np.array([
            [ cos_a, -sin_a, 0.0],
            [ sin_a,  cos_a, 0.0],
            [   0.0,    0.0, 1.0]
        ])
        
        # 将主应力张量转换到全局坐标内 S_global = R * S_principal * R^T
        S_global = R @ S_principal @ R.T
        
        return {
            "sigma_v_MPa": sigma_v,
            "sigma_H_MPa": sigma_H,
            "sigma_h_MPa": sigma_h,
            "S_principal": S_principal,
            "S_global": S_global
        }

    def global_to_tunnel_local(self, S_global: np.ndarray, tunnel_azimuth: float = 0.0, tunnel_plunge: float = 0.0) -> np.ndarray:
        """
        坐标转换：将全局大地坐标下的 3D 应力张量旋转投影到以隧道轴线为主要方向的局部坐标系中。
        定义：隧道局部坐标系中，Z' 轴平行于隧道轴线，X', Y' 位于隧道横截面（径向与切线分析面）。
        
        :param S_global: 3x3 地应力张量矩阵（大地坐标系下）
        :param tunnel_azimuth: 隧道走向方位角 (度，从正北算起顺时针或参考 X 轴旋转角度)
        :param tunnel_plunge: 隧道倾角 (度，正值表示向下倾斜，水平巷道为 0)
        :return: 隧道局部坐标系下的 3x3 应力张量矩阵 S_local
        """
        # 第一步：沿 Z 轴（水平方位）旋转方位角 az
        az_rad = np.radians(tunnel_azimuth)
        cs_az = np.cos(az_rad)
        sn_az = np.sin(az_rad)
        R_az = np.array([
            [ cs_az, sn_az, 0.0],
            [-sn_az, cs_az, 0.0],
            [   0.0,   0.0, 1.0]
        ])
        
        # 第二步：绕横截面 X' 轴旋转倾角 pl
        pl_rad = np.radians(tunnel_plunge)
        cs_pl = np.cos(pl_rad)
        sn_pl = np.sin(pl_rad)
        R_pl = np.array([
            [1.0,   0.0,    0.0],
            [0.0, cs_pl,  sn_pl],
            [0.0,-sn_pl,  cs_pl]
        ])
        
        # 整体旋转矩阵 R = R_pl * R_az
        R_total = R_pl @ R_az
        
        # S_local = R_total * S_global * R_total^T
        S_local = R_total @ S_global @ R_total.T
        
        return S_local

    def calc_kirsch_tunnel_perimeter_stress(self, S_local: np.ndarray, theta_deg: float) -> Tuple[float, float, float]:
        """
        利用 Kirsch 近似解，计算平面应变条件下的圆形巷道【孔壁围岩】极坐标截面应力。
        因为孔壁上自由面使得径向应力为0 (不计支护力)，重点计算切向应力 σ_θ (\sigma_{theta})。
        
        假设隧道横截面由局部坐标 (x', y') 构成 (上面矩阵的前 2x2 部分)。
        在孔壁边界 (r = a) 时：
        径向应力 (sigma_r) = 0 (如果不考虑内部支护抗力)
        切向应力 (sigma_theta) = (sigma_x + sigma_y) - 2 * (sigma_x - sigma_y) * cos(2*θ) - 4 * tau_xy * sin(2*θ)
        
        :param S_local: 隧道局部坐标系下的横截面应力张量 (使用 global_to_tunnel_local 的结果)
        :param theta_deg: 极角 θ (度)。一般从横截面水平右侧开始逆时针计算。例如冠顶 90°, 边墙 0°/180°
        :return: (切向应力 σ_theta, 径向应力 σ_r, 剪切应力 tau_rt) 
        """
        # 截取横截面内的主受力二维分量
        sigma_x = S_local[0, 0] # 常对应局部水平
        sigma_y = S_local[1, 1] # 常对应局部竖向/穹顶
        tau_xy  = S_local[0, 1] 
        
        theta_rad = np.radians(theta_deg)
        
        # 孔壁边界上 r = a
        # 径向应力(开挖泄压) 
        sigma_r = 0.0 
        
        # 剪应力在无粘性流体孔壁边界为 0，若有复杂剪切流动这里近似也简化为 0 (Kirsch 在 r=a 面 tau_rθ=0)
        tau_rtheta = 0.0
        
        # 关键的集中切向应力
        sigma_theta = (sigma_x + sigma_y) - 2 * (sigma_x - sigma_y) * np.cos(2 * theta_rad) - 4 * tau_xy * np.sin(2 * theta_rad)
        
        return sigma_theta, sigma_r, tau_rtheta


if __name__ == "__main__":
    # --- 测试驱动 ---
    print("--- 初始地应力解析测试 ---")
    analyzer = InSituStressAnalyzer(depth=1000.0, gamma=0.027) # 1000米深，容重 0.027
    
    # 假设强构造应力背景，k_H=1.5, k_h=1.0, 且最大主应力夹角 alpha=30度
    stress_results = analyzer.init_in_situ_stress(k_h=1.0, k_H=1.5, alpha=30.0)
    print(f"垂直自重应力: {stress_results['sigma_v_MPa']:.2f} MPa")
    print(f"最大水平主应力: {stress_results['sigma_H_MPa']:.2f} MPa")
    print("\n全局应力张量 (S_global):\n", np.round(stress_results['S_global'], 2))
    
    # --- 坐标系转化测试 ---
    print("\n--- 巷道局部坐标转换测试 ---")
    # 巷道走向方位角 45 度，几乎水平 (倾角 0)
    S_local = analyzer.global_to_tunnel_local(stress_results['S_global'], tunnel_azimuth=45.0, tunnel_plunge=0.0)
    print("局部隧道应力张量 (S_local):\n", np.round(S_local, 2))
    
    # --- 巷道围岩孔壁应力 (Kirsch 解) ---> 结合上面岩爆判定 ---
    print("\n--- 孔壁切向应力解析 (岩爆高发区) ---")
    # 岩爆往往发生在切向应力高度集中区。计算边墙 (0 度) 的切向应力:
    s_theta_wall, s_r_wall, _ = analyzer.calc_kirsch_tunnel_perimeter_stress(S_local, theta_deg=0.0)
    print(f"隧道侧壁 (0°) 切向应力集中: {s_theta_wall:.2f} MPa")
    
    # 计算拱顶 (Top, 90 度) 的切向应力:
    s_theta_crown, s_r_crown, _ = analyzer.calc_kirsch_tunnel_perimeter_stress(S_local, theta_deg=90.0)
    print(f"隧道拱顶 (90°) 切向应力集中: {s_theta_crown:.2f} MPa")
